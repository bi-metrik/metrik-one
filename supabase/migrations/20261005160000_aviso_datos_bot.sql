-- ============================================================
-- 20261005160000 — Aviso de datos del bot: cada persona lo acepta antes de que se procese
--                  su primer mensaje
--
-- Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-05-aviso-datos-primer-mensaje.md
-- Es la condicion legal (C3/C5 de Emilio) para encender el interprete con Gemini en Trappvel.
--
-- La logica vive en `supabase/functions/_shared/aviso-datos-bot*.ts`. La puerta se enciende por
-- workspace con `config_extra.aviso_datos_bot` (la escribe la sesion principal, no esta
-- migracion). Sin esa llave el bot no hace ni una consulta de mas.
--
-- ## Por que en `aceptaciones_terminos` y no en una tabla nueva
--
-- La constancia por WhatsApp ya existe y ya trae todo lo que se pide: telefono E.164, wamid del
-- mensaje con botones, del documento y del toque, `button_id`, el cuerpo crudo del webhook con su
-- firma, SHA-256 del PDF, `respondido_at` segun Meta y las guardas que congelan lo mostrado. Una
-- fila por PERSONA (telefono) por WORKSPACE por VERSION del aviso. Un colaborador de
-- `wa_collaborators` sin usuario cabe sin cambios: `calidad = 'persona_natural'` no exige empresa,
-- `usuario_id` es opcional y `negocio_id` tambien. Lo unico que falta es saber que una fila es la
-- del aviso del bot y de que version: eso es `aviso_datos_version`.
--
-- ## Que escribe: DDL, una funcion reemplazada y un cron. Ni una fila de datos.
--
--   1. `aceptaciones_terminos.aviso_datos_version` (null en toda fila que ya existe: ninguna es
--      del aviso). No nula = fila del aviso del bot, con la `version` de la config que se mostro.
--      Canal whatsapp, sin negocio y con `documento_version_id` (la version exacta del PDF).
--      Un indice unico parcial impide dos pendientes de la misma persona y version (dos mensajes
--      seguidos que llegan a la vez), y un trigger impide cambiarla en una fila pendiente (en una
--      respondida ya lo impide la guarda de 20260915060000, que compara la fila entera).
--   2. `wa_mensajes_retenidos` — lo que la persona escribio ANTES de aceptar. Nunca sale a un
--      tercero (ni Gemini, ni transcripcion): queda aqui hasta que acepta (se procesa y se borra),
--      no acepta (se borra) o vence la solicitud (se borra por el cron de abajo, a los 7 dias).
--   3. `objetos_purga_bot_por_borrar()` deja de entregar al cron de Vercel un PDF que sea de una
--      version de `documentos_contractuales_versiones`. Las filas del aviso apuntan al PDF
--      canonico del aviso (bucket `aceptaciones-documentos`, el mismo de las versiones): sin
--      esto, cuando la purga de 90 dias borrara las ultimas pendientes vencidas que lo nombran,
--      encolaria el PDF de la version y el cron lo borraria del bucket. Cuerpo de 20260915060000
--      con ese unico cambio, marcado [aviso]. Solo deja de borrar: no borra nada nuevo.
--   4. Cron `purgar-retenidos-aviso-datos` (cada hora, SQL puro): borra lo retenido vencido.
--   5. Revocacion: `revocada_at` y `revocacion_motivo` en `aceptaciones_terminos`, solo para filas
--      del aviso ya aceptadas. La escribe la sesion principal por SQL a pedido de la empresa; la
--      guarda de evidencia (cuerpo de 20260915060000 con un cambio marcado [aviso]) la deja
--      escribir una sola vez sobre una fila respondida. Revocada = la puerta vuelve a pedir el aviso.
--
-- epoca: no-rompe solo agrega una columna nullable, una tabla, indices, un trigger y un cron; la funcion reemplazada conserva firma y ACL
--
-- ## Verificacion despues de aplicar (solo lectura)
--
--   select count(*) filter (where aviso_datos_version is not null) from public.aceptaciones_terminos;
--     -> 0
--   select relrowsecurity from pg_class where oid = 'public.wa_mensajes_retenidos'::regclass;
--     -> true
--   select has_table_privilege('anon', 'public.wa_mensajes_retenidos', 'select'),
--          has_table_privilege('authenticated', 'public.wa_mensajes_retenidos', 'select');
--     -> false, false
--   select jobname, schedule from cron.job where jobname = 'purgar-retenidos-aviso-datos';
--     -> purgar-retenidos-aviso-datos | 17 * * * *
--   select pg_get_functiondef('public.objetos_purga_bot_por_borrar()'::regprocedure) like '%documentos_contractuales_versiones%';
--     -> true
--
-- ## Como revertir (antes de que exista una fila del aviso)
--
--   select cron.unschedule('purgar-retenidos-aviso-datos');
--   -- re-ejecutar el `create or replace function public.objetos_purga_bot_por_borrar()` de 20260915060000;
--   -- re-ejecutar el `create or replace function public.aceptaciones_terminos_guardas()` de 20260915060000;
--   -- quitar las columnas revocada_at y revocacion_motivo con sus dos restricciones;
--   -- quitar la tabla wa_mensajes_retenidos, el trigger trg_aceptaciones_terminos_aviso_datos, su
--   -- funcion, el indice uq_aceptaciones_terminos_aviso_pendiente, la restriccion
--   -- aceptaciones_terminos_aviso_datos y la columna aviso_datos_version.
-- ============================================================


-- ── 1. La fila del aviso en aceptaciones_terminos ───────────────────────────────────────

alter table public.aceptaciones_terminos
  add column aviso_datos_version text;

alter table public.aceptaciones_terminos
  add constraint aceptaciones_terminos_aviso_datos check (
    aviso_datos_version is null
    or (
      char_length(btrim(aviso_datos_version)) between 1 and 40
      and canal = 'whatsapp'
      and negocio_id is null
      and documento_version_id is not null
    )
  );

comment on column public.aceptaciones_terminos.aviso_datos_version is
  'No nula = aceptacion del aviso de datos del bot (config_extra.aviso_datos_bot.version que se mostro). Una version nueva vuelve a pedir aceptacion.';

-- Lo que la puerta busca en cada mensaje de un workspace con el aviso encendido.
create index idx_aceptaciones_terminos_aviso
  on public.aceptaciones_terminos (workspace_id, telefono, aviso_datos_version, estado)
  where aviso_datos_version is not null;

-- Una sola pendiente por persona, workspace y version: el segundo de dos mensajes simultaneos
-- choca aqui (23505) y el webhook relee la que gano en vez de mandar el aviso dos veces.
create unique index uq_aceptaciones_terminos_aviso_pendiente
  on public.aceptaciones_terminos (workspace_id, telefono, aviso_datos_version)
  where aviso_datos_version is not null and estado = 'pendiente';

-- Que version del aviso es una fila no cambia despues de crearla. La guarda general ya protege
-- la fila respondida entera; esto cubre la pendiente, que es la que el webhook actualiza.
create or replace function public.aceptaciones_terminos_aviso_datos()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.aviso_datos_version is distinct from old.aviso_datos_version then
    raise exception 'aceptaciones_terminos %: la version del aviso no cambia (crea una fila nueva)', old.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.aceptaciones_terminos_aviso_datos() from public, anon, authenticated;

create trigger trg_aceptaciones_terminos_aviso_datos
  before update on public.aceptaciones_terminos
  for each row execute function public.aceptaciones_terminos_aviso_datos();


-- ── 1b. Revocacion ──────────────────────────────────────────────────────────────────────
-- Quien acepto el aviso puede retirar su consentimiento (Ley 1581). No hay comando en el chat:
-- lo pide la empresa y la sesion principal lo escribe por SQL. Revocada, la puerta la trata como
-- si no hubiera aceptado: vuelve a mostrar el aviso y no procesa nada hasta una aceptacion nueva.
-- La fila no se borra ni cambia de estado: sigue siendo la evidencia de que acepto y de cuando dejo
-- de valer.
alter table public.aceptaciones_terminos
  add column revocada_at timestamptz,
  add column revocacion_motivo text;

alter table public.aceptaciones_terminos
  add constraint aceptaciones_terminos_revocada check (
    revocada_at is null
    or (
      aviso_datos_version is not null
      and estado = 'aceptado'
      and respondido_at is not null
      and revocada_at >= respondido_at
    )
  ),
  add constraint aceptaciones_terminos_revocacion_motivo check (
    revocacion_motivo is null or (revocada_at is not null and char_length(btrim(revocacion_motivo)) between 1 and 500)
  );

comment on column public.aceptaciones_terminos.revocada_at is
  'Solo aviso de datos del bot: momento en que la persona retiro su aceptacion. Se escribe una vez (por SQL, a pedido de la empresa) y no se deshace.';

-- Cuerpo de 20260915060000 con un cambio, marcado [aviso]: una fila respondida admite, ademas de
-- `contrato_fin`, que se le escriba la revocacion una sola vez.
create or replace function public.aceptaciones_terminos_guardas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.estado in ('aceptado', 'rechazado') then
      -- [purga] Unica salida: ya paso su plazo y quien borra es la purga.
      if coalesce(current_setting('metrik.purga_registros_bot', true), '') = 'on'
         and old.retencion_hasta < (now() at time zone 'America/Bogota')::date then
        return old;
      end if;
      raise exception 'aceptaciones_terminos %: ya tiene respuesta (%) y es evidencia; no se borra antes de retencion_hasta ni fuera de la purga',
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

  -- [purga] Un contrato no termina antes de aceptarse: sin esto, `contrato_fin` en 1990 seria
  -- la forma de adelantar el borrado de una evidencia.
  if new.contrato_fin is not null and new.respondido_at is not null
     and new.contrato_fin < (new.respondido_at at time zone 'America/Bogota')::date then
    raise exception 'aceptaciones_terminos %: contrato_fin (%) es anterior a la respuesta',
      new.id, new.contrato_fin;
  end if;

  if tg_op = 'UPDATE' then
    if old.estado in ('aceptado', 'rechazado') then
      -- [purga] Unica escritura sobre una fila respondida: `contrato_fin`. Se compara la fila
      -- entera menos esa columna (y la calculada), asi que una columna nueva nace protegida.
      if (to_jsonb(new) - 'contrato_fin' - 'retencion_hasta')
         = (to_jsonb(old) - 'contrato_fin' - 'retencion_hasta') then
        return new;
      end if;
      -- [aviso] La otra: revocar UNA vez la aceptacion del aviso de datos del bot. Nada mas cambia,
      -- y una revocacion escrita no se mueve ni se deshace (la restriccion
      -- `aceptaciones_terminos_revocada` dice sobre que filas cabe).
      if old.revocada_at is null and new.revocada_at is not null
         and (to_jsonb(new) - 'contrato_fin' - 'retencion_hasta' - 'revocada_at' - 'revocacion_motivo')
           = (to_jsonb(old) - 'contrato_fin' - 'retencion_hasta' - 'revocada_at' - 'revocacion_motivo') then
        return new;
      end if;
      raise exception 'aceptaciones_terminos %: ya tiene respuesta (%) y no se modifica (solo contrato_fin)',
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

revoke execute on function public.aceptaciones_terminos_guardas() from public, anon, authenticated;


-- ── 2. Lo retenido mientras la persona no acepta ────────────────────────────────────────

-- server-only: la escribe y la lee solo la edge function wa-webhook con service_role. Guarda el
-- mensaje de una persona que todavia no acepto el aviso de datos: ningun usuario final la ve.
create table public.wa_mensajes_retenidos (
  id uuid primary key default gen_random_uuid(),
  -- La solicitud de aceptacion a la que espera. Si la aceptacion se purga, lo retenido se va con ella.
  aceptacion_id uuid not null references public.aceptaciones_terminos(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  telefono text not null
    constraint wa_mensajes_retenidos_telefono_e164 check (telefono ~ '^\+[1-9][0-9]{7,14}$'),
  -- wamid del mensaje: un reintento de Meta del mismo mensaje no se retiene dos veces.
  wa_message_id text,
  tipo text not null,
  -- El mensaje tal como lo entiende el bot (`IncomingMessage`), SIN el cuerpo crudo del webhook.
  -- Audio e imagen van por su id de Meta: el archivo no se descarga hasta que se procesa.
  mensaje jsonb not null,
  -- `timestamp` de Meta (segundos epoch) y orden de llegada: con los dos se reprocesa en orden.
  meta_ts bigint,
  orden bigint generated always as identity,
  recibido_at timestamptz not null default now(),
  -- El de la aceptacion: 7 dias desde que se mostro el aviso. Vencido, el cron lo borra.
  expira_at timestamptz not null
);

alter table public.wa_mensajes_retenidos enable row level security;
revoke all on table public.wa_mensajes_retenidos from public, anon, authenticated;

create unique index uq_wa_mensajes_retenidos_wamid
  on public.wa_mensajes_retenidos (wa_message_id) where wa_message_id is not null;
create index idx_wa_mensajes_retenidos_aceptacion
  on public.wa_mensajes_retenidos (aceptacion_id, meta_ts, orden);
create index idx_wa_mensajes_retenidos_expira
  on public.wa_mensajes_retenidos (expira_at);

comment on table public.wa_mensajes_retenidos is
  'Mensajes al bot de quien aun no acepta el aviso de datos de su workspace. No salen a ningun tercero; se procesan y borran al aceptar, se borran al no aceptar o a los 7 dias.';


-- ── 3. El PDF de una version de documento no se purga ───────────────────────────────────
-- Cuerpo de 20260915060000 con un cambio, marcado [aviso].
create or replace function public.objetos_purga_bot_por_borrar()
returns table (id uuid, bucket text, ruta text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.purga_storage_pendiente p
   where p.bucket = 'aceptaciones-documentos'
     and (
       exists (
         select 1 from public.aceptaciones_terminos t
          where public.ruta_documento_aceptacion(t.documento_url) = p.ruta
       )
       -- [aviso] El PDF canonico de una version (el del aviso de datos, los terminos de un
       -- contrato) no es de ninguna aceptacion en particular: no se borra porque se purguen
       -- las aceptaciones que lo nombraban.
       or exists (
         select 1 from public.documentos_contractuales_versiones d
          where d.pdf_bucket = p.bucket
            and d.pdf_path = p.ruta
       )
     );

  return query
    select p.id, p.bucket, p.ruta
      from public.purga_storage_pendiente p
     order by p.encolado_at
     limit 1000;
end;
$$;

revoke all on function public.objetos_purga_bot_por_borrar() from public, anon, authenticated;
grant execute on function public.objetos_purga_bot_por_borrar() to service_role;


-- ── 4. Lo retenido vence a los 7 dias ───────────────────────────────────────────────────
-- SQL puro, sin secretos ni HTTP. A los :17 de cada hora para no caer con los crons en punto.
select cron.unschedule('purgar-retenidos-aviso-datos')
 where exists (select 1 from cron.job where jobname = 'purgar-retenidos-aviso-datos');

select cron.schedule(
  'purgar-retenidos-aviso-datos',
  '17 * * * *',
  $cron$delete from public.wa_mensajes_retenidos where expira_at < now();$cron$
);
