-- ============================================================
-- aceptaciones_terminos — aceptacion de un documento por el bot de WhatsApp
-- ------------------------------------------------------------
-- Detonante: el cliente de un negocio tiene que aceptar un documento (terminos, anexo,
-- contrato) y hoy eso se hace por fuera: se manda el PDF a mano y la respuesta queda en un
-- chat personal, sin constancia de QUE texto se le mostro, QUE archivo, ni CUANDO respondio.
--
-- Como funciona (la logica vive en `supabase/functions/_shared/aceptacion-terminos*.ts`):
--   1. Operacion crea una fila `pendiente` con el telefono de quien debe aceptar.
--   2. Cuando esa persona le escribe al bot (asi se abre la ventana de 24 h y el bot puede
--      contestar sin plantilla), el webhook verifica el SHA-256 del documento, se lo manda
--      y despues manda `texto_aceptacion` con dos botones: "Acepto" / "No acepto".
--   3. El toque del boton se guarda con el payload crudo de Meta (cuerpo y firma HMAC del
--      webhook), y la fila queda `aceptado` o `rechazado` para siempre.
--   4. Si quedo `aceptado`, se ejecutan sus ACCIONES POST-ACEPTACION por el mismo chat
--      (`aceptaciones_terminos_acciones`, abajo): hoy, entregar una llave de API de Valida
--      guardada en Vault, que se borra de Vault apenas sale.
--
-- Una fila por DOCUMENTO por PERSONA. Si el documento cambia, se crea otra fila: lo que ya
-- se le mostro a alguien no se edita (lo impide el trigger de abajo).
--
-- Verificacion despues de aplicar (solo lectura):
--   select relrowsecurity, relacl from pg_class where oid = 'public.aceptaciones_terminos'::regclass;
--     -> relrowsecurity = true y relacl SIN entradas para anon ni authenticated
--   select has_table_privilege('anon', 'public.aceptaciones_terminos', 'select'),
--          has_table_privilege('authenticated', 'public.aceptaciones_terminos', 'select');
--     -> false, false
--   (lo mismo con 'public.aceptaciones_terminos_acciones')
--   select proname, has_function_privilege('anon', p.oid, 'execute'),
--          has_function_privilege('authenticated', p.oid, 'execute'),
--          has_function_privilege('service_role', p.oid, 'execute')
--     from pg_proc p
--    where pronamespace = 'public'::regnamespace and proname like '%aceptacion%';
--     -> anon y authenticated false en las cuatro; service_role true en las dos RPC del secreto
-- ============================================================

-- server-only: la escribe y la lee unicamente la edge function wa-webhook con service_role, y las
-- filas pendientes se crean por SQL desde operacion. Guarda telefonos, nombres y el cuerpo crudo
-- del webhook de Meta: ningun usuario final la consulta. Cuando exista pantalla se abre con su
-- propio grant a authenticated y su politica por workspace, que es una decision aparte de esta.
create table public.aceptaciones_terminos (
  id uuid primary key default gen_random_uuid(),

  workspace_id uuid not null references public.workspaces(id),
  -- Opcional a proposito: hay documentos que no cuelgan de un negocio (terminos de uso de la
  -- plataforma). Cuando viene, el trigger exige que sea del mismo workspace.
  negocio_id uuid references public.negocios(id),

  -- E.164 con '+'. Meta manda el `from` sin '+'; el webhook lo normaliza antes de buscar.
  telefono text not null
    constraint aceptaciones_terminos_telefono_e164 check (telefono ~ '^\+[1-9][0-9]{7,14}$'),

  nombre_aceptante text not null
    constraint aceptaciones_terminos_nombre_no_vacio check (length(btrim(nombre_aceptante)) > 0),
  -- En que calidad acepta. Lista cerrada: un texto libre aqui termina con cinco maneras de
  -- escribir "representante legal", y es justo el dato que alguien va a filtrar despues.
  calidad text not null
    constraint aceptaciones_terminos_calidad check
      (calidad in ('representante_legal', 'apoderado', 'persona_natural', 'autorizado')),
  empresa_nombre text,
  empresa_nit text,

  documento_titulo text not null,
  documento_version text not null,
  -- Meta descarga el documento de esta URL: tiene que ser https y publica (o firmada) mientras
  -- la fila este vigente. Una URL de "ver en Drive" es una pagina HTML, no el archivo.
  documento_url text not null
    constraint aceptaciones_terminos_url_https check (documento_url ~ '^https://'),
  -- Hash del archivo que se acepta. El webhook lo recalcula al descargar y NO envia si no
  -- coincide: sin esa comprobacion este campo seria una afirmacion, no evidencia.
  documento_sha256 text not null
    constraint aceptaciones_terminos_sha256_hex check (documento_sha256 ~ '^[0-9a-f]{64}$'),

  -- Texto EXACTO que acompana los botones. Va tal cual al cuerpo del mensaje interactivo, que
  -- Meta limita a 1024 caracteres: mas largo, la Graph API rechaza el envio entero.
  texto_aceptacion text not null
    constraint aceptaciones_terminos_texto_largo check (char_length(texto_aceptacion) between 1 and 1024),

  estado text not null default 'pendiente'
    constraint aceptaciones_terminos_estado check
      (estado in ('pendiente', 'aceptado', 'rechazado', 'expirado')),

  -- wamid del ULTIMO mensaje con botones enviado (el recordatorio lo reemplaza). El boton que la
  -- persona toco queda identificado en `payload_respuesta` (context.id del mensaje de Meta).
  prompt_wamid text,
  -- wamid del mensaje que llevo el documento: con el se cruza su acuse en `wa_envios`.
  documento_wamid text,
  -- wamid del toque del boton. Unico: un reintento de Meta trae el mismo y no duplica nada.
  reply_wamid text,
  button_id text,
  -- { mensaje, cuerpo_webhook, x_hub_signature_256, recibido_at }. El cuerpo va como texto y
  -- no re-serializado: la firma HMAC de Meta es sobre esos bytes exactos.
  payload_respuesta jsonb,

  -- Primera vez que el documento Y los botones salieron. Desde ahi lo mostrado queda congelado.
  enviado_at timestamptz,
  -- Ultimo intento de envio (exitoso o no). Es la llave del "maximo un recordatorio cada N
  -- minutos": sin ella, cada mensaje de la persona reenviaria los botones.
  ultimo_intento_at timestamptz,
  -- Momento del toque segun el `timestamp` de Meta (el acto de la persona, no la hora a la que
  -- el webhook lo proceso; un reintento de Meta llega tarde con el timestamp original).
  respondido_at timestamptz,
  expira_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),

  -- Una fila respondida trae toda su evidencia, y una sin responder no trae nada.
  constraint aceptaciones_terminos_respuesta_completa check (
    (estado in ('aceptado', 'rechazado'))
    = (respondido_at is not null and reply_wamid is not null
       and button_id is not null and payload_respuesta is not null)
  ),
  -- "En calidad de apoderado de ..." necesita el de. Solo la persona natural va sin empresa.
  constraint aceptaciones_terminos_empresa_si_aplica check (
    calidad = 'persona_natural' or nullif(btrim(empresa_nombre), '') is not null
  )
);

alter table public.aceptaciones_terminos enable row level security;

-- Sin politicas: con RLS activo y sin grants, solo service_role la alcanza. El default de la base
-- ya no concede nada a una tabla nueva (20260810120200); el revoke se escribe igual, con nombre,
-- para que la intencion quede en el archivo y no dependa del default.
revoke all on table public.aceptaciones_terminos from public, anon, authenticated;

-- Lo que el webhook busca en CADA mensaje entrante: pendientes de un telefono.
create index idx_aceptaciones_terminos_telefono_estado
  on public.aceptaciones_terminos (telefono, estado);
create index idx_aceptaciones_terminos_negocio
  on public.aceptaciones_terminos (negocio_id) where negocio_id is not null;
create unique index uq_aceptaciones_terminos_reply_wamid
  on public.aceptaciones_terminos (reply_wamid) where reply_wamid is not null;

comment on table public.aceptaciones_terminos is
  'Aceptacion de un documento por WhatsApp (wa-webhook). Evidencia: lo mostrado se congela al enviarse y la respuesta no se modifica ni se borra.';

-- ── Guardas de evidencia ───────────────────────────────────────────────────────────────
-- Tres reglas que ningun codigo de aplicacion puede saltarse, incluido un UPDATE a mano:
--   (a) el negocio, si viene, es del mismo workspace;
--   (b) lo que ya se le mostro a la persona (texto, documento, telefono, quien acepta) no cambia:
--       si hay que corregirlo, se crea otra fila;
--   (c) una fila respondida no se modifica ni se borra, y una vencida no revive.
-- `expira_at` si se puede mover mientras este pendiente: extender el plazo no altera lo mostrado.
create or replace function public.aceptaciones_terminos_guardas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.estado in ('aceptado', 'rechazado') then
      raise exception 'aceptaciones_terminos %: ya tiene respuesta (%) y es evidencia; no se borra',
        old.id, old.estado;
    end if;
    return old;
  end if;

  if new.negocio_id is not null and not exists (
    select 1 from public.negocios n
    where n.id = new.negocio_id and n.workspace_id = new.workspace_id
  ) then
    raise exception 'aceptaciones_terminos: el negocio % no pertenece al workspace %',
      new.negocio_id, new.workspace_id;
  end if;

  if tg_op = 'UPDATE' then
    if old.estado in ('aceptado', 'rechazado') then
      raise exception 'aceptaciones_terminos %: ya tiene respuesta (%) y no se modifica',
        old.id, old.estado;
    end if;

    if old.estado = 'expirado' and new.estado <> 'expirado' then
      raise exception 'aceptaciones_terminos %: vencida; crea una fila nueva en vez de revivirla',
        old.id;
    end if;

    if old.enviado_at is not null and (
         new.enviado_at        is distinct from old.enviado_at
      or new.workspace_id      is distinct from old.workspace_id
      or new.negocio_id        is distinct from old.negocio_id
      or new.telefono          is distinct from old.telefono
      or new.nombre_aceptante  is distinct from old.nombre_aceptante
      or new.calidad           is distinct from old.calidad
      or new.empresa_nombre    is distinct from old.empresa_nombre
      or new.empresa_nit       is distinct from old.empresa_nit
      or new.documento_titulo  is distinct from old.documento_titulo
      or new.documento_version is distinct from old.documento_version
      or new.documento_url     is distinct from old.documento_url
      or new.documento_sha256  is distinct from old.documento_sha256
      or new.texto_aceptacion  is distinct from old.texto_aceptacion
    ) then
      raise exception 'aceptaciones_terminos %: ya se le mostro a la persona; lo mostrado no cambia (crea una fila nueva)',
        old.id;
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_aceptaciones_terminos_guardas
  before insert or update or delete on public.aceptaciones_terminos
  for each row execute function public.aceptaciones_terminos_guardas();

-- PostgreSQL no exige EXECUTE para DISPARAR un trigger, solo para crearlo: el revoke no la apaga.
revoke execute on function public.aceptaciones_terminos_guardas() from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════════════════
-- Acciones post-aceptacion
-- ────────────────────────────────────────────────────────────────────────────────────────
-- Lo que se le entrega a la persona por el mismo chat cuando toca "Acepto" (la ventana de
-- 24 h ya la abrio ella). Una fila por accion; el webhook las ejecuta UNA vez, en el momento
-- de registrar la aceptacion, y nunca las reintenta solo.
--
-- Tipos:
--   · enviar_credencial_valida — manda la llave de API de Valida del cliente. La llave vive
--     en Supabase Vault (`vault.secrets`, cifrada) y la fila guarda SOLO su id. Apenas la
--     Graph API acepta el mensaje, el secreto se borra de Vault.
--   · enviar_acceso_portal     — modelado, SIN implementar: el portal de autoservicio de Valida
--     todavia no existe. El webhook la deja `pendiente`.
--
-- Estados: pendiente -> enviada | fallida. `fallida` conserva el secreto en Vault para que
-- alguien decida reenviarlo a mano; no hay reintento automatico de una llave.
--
-- ⚠️ La llave nunca va en claro en una tabla, en `wa_envios.preview` ni en consola. En el SQL
-- de operacion aparece una sola vez, dentro de `vault.create_secret(...)`: esa sentencia no
-- debe fallar (Postgres escribe en su log el texto de una sentencia que falla).
-- ════════════════════════════════════════════════════════════════════════════════════════

-- server-only: la carga operacion por SQL y la ejecuta la edge function wa-webhook con
-- service_role. Referencia secretos de Vault; ningun usuario final la consulta.
create table public.aceptaciones_terminos_acciones (
  id uuid primary key default gen_random_uuid(),
  aceptacion_id uuid not null references public.aceptaciones_terminos(id),
  tipo text not null
    constraint aceptaciones_terminos_acciones_tipo check
      (tipo in ('enviar_credencial_valida', 'enviar_acceso_portal')),
  estado text not null default 'pendiente'
    constraint aceptaciones_terminos_acciones_estado check
      (estado in ('pendiente', 'enviada', 'fallida')),

  -- id en `vault.secrets`. NUNCA el valor. Queda en null cuando el secreto se borra.
  secreto_id uuid,
  secreto_borrado_at timestamptz,

  -- Reclamo del envio: se pone UNA vez, atomico, antes de leer el secreto. Es lo que impide que
  -- dos procesos (o un reintento de Meta que se colara) manden la llave dos veces.
  intentado_at timestamptz,
  enviada_at timestamptz,
  -- wamid del mensaje que llevo la entrega (con el se cruza su acuse en `wa_envios`).
  wamid text,
  -- Por que fallo, en palabras. Nunca contiene el secreto.
  error text,
  created_at timestamptz not null default now(),

  -- Una accion de cada tipo por aceptacion: dos llaves para la misma aceptacion es un error de carga.
  constraint uq_aceptaciones_terminos_acciones_tipo unique (aceptacion_id, tipo),
  constraint aceptaciones_terminos_acciones_enviada_completa check (
    (estado = 'enviada') = (enviada_at is not null and wamid is not null)
  ),
  constraint aceptaciones_terminos_acciones_credencial_con_secreto check (
    tipo <> 'enviar_credencial_valida' or secreto_id is not null or secreto_borrado_at is not null
  )
);

alter table public.aceptaciones_terminos_acciones enable row level security;
revoke all on table public.aceptaciones_terminos_acciones from public, anon, authenticated;

create index idx_aceptaciones_terminos_acciones_pendientes
  on public.aceptaciones_terminos_acciones (aceptacion_id) where estado = 'pendiente';

comment on table public.aceptaciones_terminos_acciones is
  'Acciones que wa-webhook ejecuta una vez al registrarse una aceptacion. secreto_id apunta a vault.secrets; el valor nunca se guarda aqui.';

-- ── Guardas de las acciones ──────────────────────────────────────────────────────────────
--   (a) solo se cargan acciones sobre una aceptacion `pendiente`: sobre una ya respondida no
--       las ejecutaria nadie, y parecerian entregadas sin haberlo sido;
--   (b) el secreto referenciado tiene que existir en Vault (un id mal copiado se detecta al
--       cargar, no cuando la persona ya acepto);
--   (c) una accion `enviada` es evidencia: no se borra, y lo unico que se le puede escribir es
--       la constancia de que su secreto se borro de Vault;
--   (d) borrar una accion no enviada borra tambien su secreto de Vault: no quedan llaves huerfanas.
-- SECURITY DEFINER porque (b) y (d) tocan `vault.secrets`, que no es de quien carga la fila.
create or replace function public.aceptaciones_terminos_acciones_guardas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.estado = 'enviada' then
      raise exception 'aceptaciones_terminos_acciones %: ya se envio y es evidencia; no se borra', old.id;
    end if;
    if old.secreto_id is not null then
      delete from vault.secrets s where s.id = old.secreto_id;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' and not exists (
    select 1 from public.aceptaciones_terminos t
    where t.id = new.aceptacion_id and t.estado = 'pendiente'
  ) then
    raise exception 'aceptaciones_terminos_acciones: la aceptacion % no esta pendiente', new.aceptacion_id;
  end if;

  if tg_op = 'UPDATE' then
    if old.estado = 'enviada' then
      -- Unica escritura permitida sobre una accion enviada: registrar que su secreto se borro.
      if old.secreto_id is not null and new.secreto_id is null
         and old.secreto_borrado_at is null and new.secreto_borrado_at is not null
         and (new.aceptacion_id, new.tipo, new.estado, new.intentado_at, new.enviada_at, new.wamid, new.error)
             is not distinct from
             (old.aceptacion_id, old.tipo, old.estado, old.intentado_at, old.enviada_at, old.wamid, old.error)
      then
        return new;
      end if;
      raise exception 'aceptaciones_terminos_acciones %: ya se envio y no se modifica', old.id;
    end if;
    if new.aceptacion_id is distinct from old.aceptacion_id or new.tipo is distinct from old.tipo then
      raise exception 'aceptaciones_terminos_acciones %: aceptacion y tipo no cambian', old.id;
    end if;
  end if;

  if new.secreto_id is not null
     and (tg_op = 'INSERT' or new.secreto_id is distinct from old.secreto_id)
     and not exists (select 1 from vault.secrets s where s.id = new.secreto_id) then
    raise exception 'aceptaciones_terminos_acciones: el secreto % no existe en Vault', new.secreto_id;
  end if;

  return new;
end;
$$;

create trigger trg_aceptaciones_terminos_acciones_guardas
  before insert or update or delete on public.aceptaciones_terminos_acciones
  for each row execute function public.aceptaciones_terminos_acciones_guardas();

revoke all on function public.aceptaciones_terminos_acciones_guardas() from public, anon, authenticated;

-- ── Lectura y borrado del secreto (solo service_role) ─────────────────────────────────────
-- PostgREST no expone el esquema `vault`, asi que la edge function llega por estas dos RPC,
-- mismo patron que `leer_secretos_workspace` (20260915010000). Estan acotadas a proposito: no
-- leen "un secreto", leen EL de una accion de credencial pendiente, ya reclamada, cuya
-- aceptacion quedo `aceptado`. Fuera de ese momento devuelven null.
create or replace function public.leer_secreto_accion_aceptacion(p_accion_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $function$
  select s.decrypted_secret
  from public.aceptaciones_terminos_acciones a
  join public.aceptaciones_terminos t on t.id = a.aceptacion_id
  join vault.decrypted_secrets s on s.id = a.secreto_id
  where a.id = p_accion_id
    and a.tipo = 'enviar_credencial_valida'
    and a.estado = 'pendiente'
    and a.intentado_at is not null
    and t.estado = 'aceptado';
$function$;

-- Borra de Vault el secreto de una accion YA enviada y deja constancia en la fila. Devuelve
-- false si no habia nada que borrar (accion no enviada, o secreto ya borrado): llamarla dos
-- veces no rompe nada.
create or replace function public.borrar_secreto_accion_aceptacion(p_accion_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secreto uuid;
begin
  select a.secreto_id into v_secreto
  from public.aceptaciones_terminos_acciones a
  where a.id = p_accion_id and a.estado = 'enviada'
  for update;

  if v_secreto is null then
    return false;
  end if;

  delete from vault.secrets s where s.id = v_secreto;

  update public.aceptaciones_terminos_acciones
     set secreto_id = null, secreto_borrado_at = now()
   where id = p_accion_id;

  return true;
end;
$function$;

-- Se revoca nombrando cada rol: en esta base el EXECUTE de `authenticated` viene de los
-- privilegios por defecto del esquema, y `revoke ... from public` no se lo quita.
revoke all on function public.leer_secreto_accion_aceptacion(uuid) from public, anon, authenticated;
revoke all on function public.borrar_secreto_accion_aceptacion(uuid) from public, anon, authenticated;
grant execute on function public.leer_secreto_accion_aceptacion(uuid) to service_role;
grant execute on function public.borrar_secreto_accion_aceptacion(uuid) to service_role;
