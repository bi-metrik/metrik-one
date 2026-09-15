-- ============================================================
-- purga_registros_bot — los plazos de conservacion del bot de WhatsApp, ejecutados
-- ------------------------------------------------------------
-- Detonante: Mauricio aprobo el 2026-09-15 los plazos de conservacion de los registros del
-- bot, y la Politica de Datos de Valida v1.4 los publica. La Politica NO sale hasta que esta
-- purga corra en produccion: publicar un plazo que ningun proceso cumple es declarar algo
-- falso. Hasta hoy ningun cron borraba nada del bot.
--
-- Plazos (fijados tambien en `src/lib/retencion-bot/plazos.ts`, cuya prueba los compara con la
-- Politica v1.4 y ejecuta ESTE archivo contra Postgres en cada PR):
--
--   registro                                    plazo                              al vencer
--   aceptaciones_terminos aceptadas/rechazadas  vigencia del contrato + diez (10)  se borran la fila, sus
--     + sus acciones + su PDF                   años (`retencion_hasta`)           acciones y el PDF
--   acuse de entrega de la credencial           igual que la aceptacion            se COPIA a la accion; el
--     (wa_envios de una accion)                                                    wa_envios sigue su plazo
--   aceptaciones pendientes/vencidas            90 dias despues de `expira_at`     se borran
--   wa_message_log                              90 dias                            telefono y texto a null
--   otros wa_envios                             12 meses                           telefono, texto y wamid a null
--   bot_sessions                                7 dias despues de `expires_at`     se borran
--   metricas agregadas                          indefinido                         nunca llevan telefono
--
-- ── Decisiones que el cuadro no dice ───────────────────────────────────────────────────
--
-- (1) FIN DEL CONTRATO. ONE no modela cuando termina un contrato, y el de Valida no tiene
--     fecha: sus Terminos rigen "durante la vigencia del paquete y de los paquetes que el
--     Cliente adquiera despues" (clausula 13.1). Por eso `contrato_fin` es un dato que se
--     escribe A MANO cuando la relacion termina, y `retencion_hasta` se calcula sola:
--     contrato_fin + diez (10) años. MIENTRAS `contrato_fin` SEA NULL LA ACEPTACION NO SE
--     PURGA NUNCA: el contrato sigue vigente. Una aceptacion RECHAZADA no llega a tener
--     contrato: su vigencia termina el dia que se rechazo, asi que sin `contrato_fin` cuenta
--     desde `respondido_at`. Las fechas se leen en hora de Colombia.
--
-- (2) EL WAMID ES EL TELEFONO. `wamid.HBgMNTczMjE1ODg0NDU2...` es base64 y su prefijo
--     decodifica al numero del destinatario en claro (`\x1c\x18\x0c573215884456`). Anular
--     `phone` y dejar `wa_message_id` dejaria el telefono recuperable con un base64 -d, asi
--     que la anonimizacion de wa_envios anula tambien el wamid. Quedan estado, fecha del
--     estado, codigo y titulo del error, origen, plantilla e intent.
--
-- (3) EL PDF SE BORRA POR LA API DE STORAGE, NO DESDE AQUI. Borrar la fila de
--     `storage.objects` no borra el archivo del almacenamiento (queda el binario huerfano),
--     y Supabase rechaza el DELETE directo sobre esas tablas. Esta funcion ENCOLA la ruta en
--     `purga_storage_pendiente`, en la misma transaccion que borra la fila, y el cron de
--     Vercel `/api/crons/purgar-objetos-bot` la borra con la API y vacia la cola. Si ese cron
--     falla, la ruta espera en la cola: no se pierde.
--     ⚠️ Un PDF puede ser de VARIAS aceptaciones (hoy las dos filas de produccion apuntan al
--     mismo `4d-soft/terminos-uso-valida-4d-soft-v1.pdf`): solo se encola si ya ninguna fila
--     que sobrevive lo referencia, y el cron lo vuelve a comprobar antes de borrar.
--
-- (4) LA SALIDA DE LOS TRIGGERS. Las guardas de evidencia siguen bloqueando todo lo que
--     bloqueaban, con dos excepciones exactas:
--       · borrar una aceptacion respondida o su accion enviada, SOLO si ya paso
--         `retencion_hasta` Y la sesion trae `metrik.purga_registros_bot = on`, que pone esta
--         funcion con `set_config(..., true)` (local a su transaccion);
--       · escribir `contrato_fin` en una aceptacion respondida, y copiar en una accion enviada
--         el acuse EXACTO que tiene su wa_envios.
--     ⚠️ La GUC no es un secreto: cualquier rol que ya pueda borrar la tabla (service_role)
--     puede ponerla. Encauza el borrado por la funcion; el candado de verdad es la fecha,
--     que nadie puede saltarse sin ser dueño de la tabla.
--
-- (5) EL CRON ES pg_cron Y NO LLEVA SECRETOS. La purga es SQL puro: no llama HTTP ni lee
--     Vault, asi que corre aunque la app de Vercel este caida. Mismo patron que
--     `resolver-notificaciones-obsoletas` y `tomar-proceso-snapshot`.
--
-- ── Que hace este archivo al aplicarse en produccion ───────────────────────────────────
--
--   · wa_message_log (417 filas) y wa_envios (110): `phone` deja de ser NOT NULL. No cambia
--     ninguna fila.
--   · aceptaciones_terminos (2 filas): columnas `contrato_fin` y `retencion_hasta`.
--       def579c7 (4D SOFT, contrato vigente)      -> contrato_fin null, retencion_hasta null
--       41233b25 (prueba interna de Mauricio,     -> contrato_fin 2026-09-15,
--                 llave ficticia, sin contrato)      retencion_hasta 2036-09-15
--   · aceptaciones_terminos_acciones (2 filas): columnas `acuse_status` y `acuse_status_at`,
--     rellenas desde su wa_envios:
--       530b764f (llave de 4D SOFT)  <- wa_envios b896558a: delivered 2026-09-15 13:49:24Z
--       fe749f28 (llave de prueba)   <- wa_envios 59e958be: read      2026-09-15 13:23:30Z
--   · Crea `purga_storage_pendiente` y `purga_registros_bot_corridas` (vacias), las funciones
--     y el job diario `purgar-registros-bot` (08:00 UTC). NO ejecuta la purga: la primera
--     corrida es la del cron, y hasta entonces todo lo de arriba es reversible.
--
-- ── Verificacion despues de aplicar (solo lectura) ─────────────────────────────────────
--   select proname, proacl from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('purgar_registros_bot', 'objetos_purga_bot_por_borrar', 'ruta_documento_aceptacion');
--     -> proacl sin `=X/` (PUBLIC), sin `anon=` y sin `authenticated=`; `service_role=X` solo en
--        objetos_purga_bot_por_borrar
--   select jobname, schedule, command from cron.job where jobname = 'purgar-registros-bot';
--   select id, contrato_fin, retencion_hasta from public.aceptaciones_terminos;
--   select id, wamid, acuse_status, acuse_status_at from public.aceptaciones_terminos_acciones;
--   Despues de la primera corrida:
--   select ejecutada_at, conteos from public.purga_registros_bot_corridas order by ejecutada_at desc limit 1;
--
-- ── Como revertir ──────────────────────────────────────────────────────────────────────
--   ⚠️ Lo que la purga ya anonimizo o borro NO vuelve. Antes de la primera corrida:
--   select cron.unschedule('purgar-registros-bot');
--   drop function public.purgar_registros_bot();
--   drop function public.objetos_purga_bot_por_borrar();
--   drop table public.purga_storage_pendiente, public.purga_registros_bot_corridas;
--   -- Las guardas: re-ejecutar los dos `create or replace function` de 20260915040000.
--   drop function public.ruta_documento_aceptacion(text);
--   alter table public.aceptaciones_terminos drop column retencion_hasta, drop column contrato_fin;
--   alter table public.aceptaciones_terminos_acciones drop column acuse_status, drop column acuse_status_at;
--   -- `phone` NOT NULL solo se puede reponer si ninguna fila quedo anonimizada.
-- ============================================================


-- ════════════════════════════════════════════════════════════════════════════════════════
-- 1. Telefonos anulables
-- ════════════════════════════════════════════════════════════════════════════════════════
-- Anonimizar es poner null, no un marcador: un 'anonimizado' en `phone` se cuenta como un
-- numero en cualquier agrupacion y ademas choca con la busqueda por telefono del rate limit.
alter table public.wa_message_log alter column phone drop not null;
alter table public.wa_envios alter column phone drop not null;


-- ════════════════════════════════════════════════════════════════════════════════════════
-- 2. Fecha de retencion de las aceptaciones
-- ════════════════════════════════════════════════════════════════════════════════════════
alter table public.aceptaciones_terminos
  -- Dia en que termino el contrato que esta aceptacion soporta. Null = sigue vigente.
  add column contrato_fin date,
  -- Ultimo dia (hora de Colombia) en que la fila se conserva. Calculada: nadie la escribe.
  add column retencion_hasta date generated always as (
    (coalesce(
       contrato_fin,
       case when estado = 'rechazado' then (respondido_at at time zone 'America/Bogota')::date end
     ) + interval '10 years')::date
  ) stored;

comment on column public.aceptaciones_terminos.contrato_fin is
  'Fin del contrato que soporta esta aceptacion. Se escribe a mano cuando la relacion termina; null = vigente y la fila no se purga.';
comment on column public.aceptaciones_terminos.retencion_hasta is
  'contrato_fin + 10 anios (rechazada sin contrato: respondido_at + 10). purgar_registros_bot borra la fila el dia siguiente.';


-- ════════════════════════════════════════════════════════════════════════════════════════
-- 3. Copia del acuse de entrega en la accion
-- ════════════════════════════════════════════════════════════════════════════════════════
-- El wamid ya esta en la accion (`wamid`): es la llave con la que se copia. Lo que falta es
-- como termino ese mensaje, que hoy solo sabe `wa_envios`, y wa_envios se anonimiza a los 12
-- meses mientras la prueba de entrega tiene que durar lo que dure la aceptacion.
alter table public.aceptaciones_terminos_acciones
  add column acuse_status text
    constraint aceptaciones_terminos_acciones_acuse_status check
      (acuse_status in ('aceptado', 'sent', 'delivered', 'read', 'failed', 'rechazado')),
  add column acuse_status_at timestamptz;

comment on column public.aceptaciones_terminos_acciones.acuse_status is
  'Copia del status de wa_envios para `wamid`. La escribe purgar_registros_bot y solo puede ser la copia exacta.';


-- ════════════════════════════════════════════════════════════════════════════════════════
-- 4. Guardas de evidencia, con su salida
-- ════════════════════════════════════════════════════════════════════════════════════════
-- Cuerpo de 20260915040000 con tres cambios, marcados con [purga]. Todo lo demas, igual.
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


create or replace function public.aceptaciones_terminos_acciones_guardas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- [purga] Una accion enviada es evidencia de la aceptacion y muere con ella: solo si la
    -- aceptacion ya cumplio su plazo y quien borra es la purga.
    if old.estado = 'enviada' and not (
         coalesce(current_setting('metrik.purga_registros_bot', true), '') = 'on'
         and exists (
           select 1 from public.aceptaciones_terminos t
           where t.id = old.aceptacion_id
             and t.estado in ('aceptado', 'rechazado')
             and t.retencion_hasta < (now() at time zone 'America/Bogota')::date
         )
       ) then
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
      -- Escritura permitida (a): registrar que su secreto se borro de Vault.
      -- [purga] La comparacion pasa a ser la fila entera menos esas dos columnas: con la lista
      -- vieja de columnas, esta rama habria dejado escribir tambien el acuse a mano.
      if old.secreto_id is not null and new.secreto_id is null
         and old.secreto_borrado_at is null and new.secreto_borrado_at is not null
         and (to_jsonb(new) - 'secreto_id' - 'secreto_borrado_at')
             = (to_jsonb(old) - 'secreto_id' - 'secreto_borrado_at')
      then
        return new;
      end if;
      -- [purga] Escritura permitida (b): la copia EXACTA del acuse que tiene su wa_envios. No
      -- se puede escribir un acuse que Meta no haya mandado.
      if (to_jsonb(new) - 'acuse_status' - 'acuse_status_at')
         = (to_jsonb(old) - 'acuse_status' - 'acuse_status_at')
         and exists (
           select 1 from public.wa_envios e
           where e.wa_message_id = old.wamid
             and e.status = new.acuse_status
             and e.status_at is not distinct from new.acuse_status_at
         )
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

revoke all on function public.aceptaciones_terminos_acciones_guardas() from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════════════════════
-- 5. Relleno de las filas que ya existen
-- ════════════════════════════════════════════════════════════════════════════════════════
-- Pasan por las guardas nuevas, no alrededor de ellas: si una de estas dos sentencias
-- necesitara desactivar un trigger, la salida estaria mal hecha.

-- La prueba de entrega. Generico (todas las acciones enviadas con su wa_envios); en produccion
-- son dos, y la que importa es la llave de 4D SOFT: wa_envios b896558a, delivered 13:49:24Z.
update public.aceptaciones_terminos_acciones a
   set acuse_status = e.status,
       acuse_status_at = e.status_at
  from public.wa_envios e
 where a.estado = 'enviada'
   and a.wamid is not null
   and e.wa_message_id = a.wamid
   and (a.acuse_status, a.acuse_status_at) is distinct from (e.status, e.status_at);

do $$
begin
  -- Si la accion de 4D SOFT existe (produccion), su acuse tiene que haber quedado copiado.
  if exists (select 1 from public.aceptaciones_terminos_acciones
             where id = '530b764f-38fa-400e-baa5-64a2f31e1a05' and acuse_status is null) then
    raise exception 'purga_registros_bot: el acuse de la llave de 4D SOFT no se copio';
  end if;
end $$;

-- La aceptacion de prueba de Mauricio (empresa "METRIK IA S.A.S. (prueba interna)", llave
-- ficticia) no soporta ningun contrato: se da por terminado el dia de la prueba. La de
-- 4D SOFT (def579c7) NO se toca: su contrato sigue vigente y queda con retencion null.
update public.aceptaciones_terminos
   set contrato_fin = date '2026-09-15'
 where id = '41233b25-ec19-4922-9547-59bc4a9a2c92'
   and contrato_fin is null;


-- ════════════════════════════════════════════════════════════════════════════════════════
-- 6. Cola de objetos de Storage y bitacora de corridas
-- ════════════════════════════════════════════════════════════════════════════════════════

-- server-only: la llena purgar_registros_bot (pg_cron) y la vacia el cron de Vercel con
-- service_role. Ningun usuario final la lee.
create table public.purga_storage_pendiente (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  -- Ruta dentro del bucket tal como aparece en la URL firmada (puede venir percent-encoded).
  ruta text not null,
  encolado_at timestamptz not null default now(),
  constraint uq_purga_storage_pendiente unique (bucket, ruta)
);

alter table public.purga_storage_pendiente enable row level security;
revoke all on table public.purga_storage_pendiente from public, anon, authenticated;
grant select, delete on table public.purga_storage_pendiente to service_role;

comment on table public.purga_storage_pendiente is
  'Objetos de Storage de registros ya purgados, a la espera de que /api/crons/purgar-objetos-bot los borre por la API.';

-- server-only: la escribe purgar_registros_bot. Es la metrica agregada de la purga: solo
-- conteos, nunca un telefono ni en claro ni en hash.
create table public.purga_registros_bot_corridas (
  id uuid primary key default gen_random_uuid(),
  ejecutada_at timestamptz not null default now(),
  conteos jsonb not null
);

alter table public.purga_registros_bot_corridas enable row level security;
revoke all on table public.purga_registros_bot_corridas from public, anon, authenticated;

comment on table public.purga_registros_bot_corridas is
  'Una fila por corrida de purgar_registros_bot con sus conteos. Es la constancia de que la purga corre.';


-- ════════════════════════════════════════════════════════════════════════════════════════
-- 7. Funciones
-- ════════════════════════════════════════════════════════════════════════════════════════

-- Ruta del PDF dentro del bucket, sacada de la URL de Storage (firmada, publica o autenticada).
-- Null si la URL no es de este bucket: ese archivo no es nuestro para borrarlo.
create or replace function public.ruta_documento_aceptacion(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select substring(p_url from '/storage/v1/object/(?:sign|public|authenticated)/aceptaciones-documentos/([^?#]+)');
$$;

-- Interna: solo la usan las dos funciones de abajo, que corren como su dueño.
revoke all on function public.ruta_documento_aceptacion(text) from public, anon, authenticated, service_role;


create or replace function public.purgar_registros_bot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ahora timestamptz := now();
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_acuses int;
  v_envios int;
  v_log int;
  v_sesiones int;
  v_acciones int;
  v_sin_respuesta int;
  v_con_respuesta int;
  v_objetos int;
  v_ids uuid[];
  v_rutas text[];
  v_conteos jsonb;
begin
  -- Abre la salida de las guardas SOLO para esta transaccion.
  perform set_config('metrik.purga_registros_bot', 'on', true);

  -- 1. La prueba de entrega se copia ANTES de anonimizar wa_envios, y en cada corrida: un
  --    'read' que llega despues del 'delivered' tambien tiene que quedar.
  update public.aceptaciones_terminos_acciones a
     set acuse_status = e.status,
         acuse_status_at = e.status_at
    from public.wa_envios e
   where a.estado = 'enviada'
     and a.wamid is not null
     and e.wa_message_id = a.wamid
     and (a.acuse_status, a.acuse_status_at) is distinct from (e.status, e.status_at);
  get diagnostics v_acuses = row_count;

  -- 2. wa_envios: 12 meses. El wamid se va con el telefono porque lo lleva dentro (base64).
  update public.wa_envios
     set phone = null,
         preview = null,
         wa_message_id = null
   where created_at < v_ahora - interval '12 months'
     and (phone is not null or preview is not null or wa_message_id is not null);
  get diagnostics v_envios = row_count;

  -- 3. wa_message_log: 90 dias. Quedan intent, direccion, modelo, tokens, latencia, confianza.
  update public.wa_message_log
     set phone = null,
         message_preview = null
   where created_at < v_ahora - interval '90 days'
     and (phone is not null or message_preview is not null);
  get diagnostics v_log = row_count;

  -- 4. bot_sessions: 7 dias despues de vencer.
  delete from public.bot_sessions
   where expires_at < v_ahora - interval '7 days';
  get diagnostics v_sesiones = row_count;

  -- 5. Aceptaciones que cumplieron su plazo. Se bloquean al elegirlas: si el webhook responde
  --    una en este instante, espera a que la purga termine y no se borra algo recien aceptado.
  with elegidas as (
    select t.id
      from public.aceptaciones_terminos t
     where (t.estado in ('pendiente', 'expirado')
            and t.expira_at < v_ahora - interval '90 days'
            -- Sin respuesta no hay accion enviada; si apareciera una, la fila no se toca en
            -- vez de tumbar la corrida entera con la guarda.
            and not exists (select 1 from public.aceptaciones_terminos_acciones a
                             where a.aceptacion_id = t.id and a.estado = 'enviada'))
        or (t.estado in ('aceptado', 'rechazado')
            and t.retencion_hasta < v_hoy)
     for update
  )
  select coalesce(array_agg(id), '{}') into v_ids from elegidas;

  -- Las acciones primero (la llave foranea no cascadea). Una accion no enviada que aun tenga
  -- secreto se lo lleva de Vault por su guarda.
  delete from public.aceptaciones_terminos_acciones a
   where a.aceptacion_id = any (v_ids);
  get diagnostics v_acciones = row_count;

  with borradas as (
    delete from public.aceptaciones_terminos t
     where t.id = any (v_ids)
    returning t.estado, public.ruta_documento_aceptacion(t.documento_url) as ruta
  )
  select count(*) filter (where estado in ('pendiente', 'expirado')),
         count(*) filter (where estado in ('aceptado', 'rechazado')),
         coalesce(array_agg(distinct ruta) filter (where ruta is not null), '{}')
    into v_sin_respuesta, v_con_respuesta, v_rutas
    from borradas;

  -- 6. PDFs. Sentencia APARTE del delete: dentro de la misma, el `not exists` veria todavia las
  --    filas que se estan borrando y nunca encolaria nada.
  insert into public.purga_storage_pendiente (bucket, ruta)
  select 'aceptaciones-documentos', r.ruta
    from unnest(v_rutas) as r(ruta)
   where not exists (
     select 1 from public.aceptaciones_terminos t
      where public.ruta_documento_aceptacion(t.documento_url) = r.ruta
   )
  on conflict (bucket, ruta) do nothing;
  get diagnostics v_objetos = row_count;

  v_conteos := jsonb_build_object(
    'acuses_copiados', v_acuses,
    'wa_envios_anonimizados', v_envios,
    'wa_message_log_anonimizados', v_log,
    'bot_sessions_borradas', v_sesiones,
    'aceptaciones_sin_respuesta_borradas', v_sin_respuesta,
    'aceptaciones_con_respuesta_borradas', v_con_respuesta,
    'acciones_borradas', v_acciones,
    'objetos_encolados', v_objetos
  );

  insert into public.purga_registros_bot_corridas (conteos) values (v_conteos);

  perform set_config('metrik.purga_registros_bot', '', true);
  return v_conteos;
end;
$$;

-- Nadie la llama por RPC: la corre pg_cron como su dueño. Se revoca nombrando cada rol porque
-- en esta base el EXECUTE de `authenticated` viene de los privilegios por defecto del esquema,
-- y `revoke ... from public` no se lo quita. Tampoco service_role: ningun proceso de la app
-- tiene por que adelantar una purga.
revoke all on function public.purgar_registros_bot() from public, anon, authenticated, service_role;


-- Lo que el cron de Vercel tiene que borrar de Storage. Antes de devolverlo descarta lo que
-- volvio a quedar referenciado (una aceptacion nueva que reusa el mismo PDF entre la purga y
-- el borrado): ese archivo ya no es basura.
create or replace function public.objetos_purga_bot_por_borrar()
returns table (id uuid, bucket text, ruta text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.purga_storage_pendiente p
   where p.bucket = 'aceptaciones-documentos'
     and exists (
       select 1 from public.aceptaciones_terminos t
        where public.ruta_documento_aceptacion(t.documento_url) = p.ruta
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


-- ════════════════════════════════════════════════════════════════════════════════════════
-- 8. Cron diario
-- ════════════════════════════════════════════════════════════════════════════════════════
-- 08:00 UTC (03:00 en Colombia): el bot casi no tiene trafico. El borrado de los PDF corre
-- en Vercel a las 08:30 UTC, despues de esta.
select cron.unschedule('purgar-registros-bot')
 where exists (select 1 from cron.job where jobname = 'purgar-registros-bot');

select cron.schedule(
  'purgar-registros-bot',
  '0 8 * * *',
  $cron$select public.purgar_registros_bot();$cron$
);
