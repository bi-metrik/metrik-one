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
--   select proacl, has_function_privilege('anon', p.oid, 'execute'),
--          has_function_privilege('authenticated', p.oid, 'execute')
--     from pg_proc p where proname = 'aceptaciones_terminos_guardas';
--     -> false, false
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
set search_path = public
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
