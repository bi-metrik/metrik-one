-- ============================================================
-- 20261002140000 — La purga de 90 dias tambien limpia lo que guarda el interprete
--
-- Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-02-purga-interprete.md
-- Cierra el «PENDIENTE CONOCIDO» de 20261002120000_bot_conversacional_interprete. Va ANTES de
-- encender `config_extra.bot_conversacional` en cualquier workspace de cliente.
--
-- Que cambia: SOLO el paso 3 de `public.purgar_registros_bot()` (wa_message_log, 90 dias). Ademas
-- de `phone` y `message_preview` anula:
--   · `interprete_propuesta`: el JSON del modelo con la evidencia LITERAL de cada accion (un trozo
--     del escrito, puede traer nombres de clientes) y otros campos de texto (descripcion, nombre…);
--   · `interprete_rechazo`: casi siempre un codigo (V4_estado, despacho_sin_efecto…), pero en los
--     fallback de `llamarGemini` es `String(err)`, y el error de JSON.parse en Deno/V8 cita el
--     comienzo de la salida del modelo: «SyntaxError: Unexpected token 'h', "hola Pedro"... is not
--     valid JSON». Puede llevar texto del mensaje, asi que se va con el.
-- Se quedan `interprete_accion` (literal del validador o `rol.<accion del enum>`) e
-- `interprete_resultado` (atendido | fallback_<motivo enum>): codigos, nunca texto del mensaje.
-- El `where` incluye las dos columnas: una fila con solo eso pendiente tambien se limpia.
--
-- Cuerpo: copia de la funcion TAL COMO ESTA EN PRODUCCION (pg_get_functiondef, md5
-- f2ad8f45eac97dcac12e33699e9f4aaf, leido el 2026-10-02; identico al de 20260915060000) con ese
-- unico cambio. Mismo dueño (postgres: `create or replace` lo conserva), `security definer`,
-- `search_path = ''` y ACL (`{postgres=X/postgres}`); el revoke de abajo es el mismo de
-- 20260915060000 y no cambia nada si ya estaba asi.
--
-- Que hace al aplicarse: reemplaza la funcion. No toca filas (al 2026-10-02 ninguna fila de
-- wa_message_log tiene columnas `interprete_%` llenas; el interprete esta apagado). La primera
-- corrida con el cambio es la del cron de las 08:00 UTC.
--
-- Verificacion despues de aplicar (solo lectura):
--   select pg_get_userbyid(p.proowner) as dueno, p.prosecdef, p.proconfig, p.proacl,
--          md5(pg_get_functiondef(p.oid)) as md5,
--          pg_get_functiondef(p.oid) like '%interprete_propuesta = null%' as anula_propuesta,
--          pg_get_functiondef(p.oid) like '%interprete_rechazo = null%' as anula_rechazo
--     from pg_proc p
--    where p.oid = 'public.purgar_registros_bot()'::regprocedure;
--   -- postgres | true | {"search_path=\"\""} | {postgres=X/postgres}
--   -- | 2968113b01ecf36334f05987f20efdc9 | true | true
--
-- Como revertir: re-ejecutar el `create or replace function public.purgar_registros_bot()` de
-- 20260915060000 (md5 en produccion vuelve a f2ad8f45eac97dcac12e33699e9f4aaf). Lo que la purga
-- ya anulo no vuelve.
-- ============================================================

create or replace function public.purgar_registros_bot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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

  -- 3. wa_message_log: 90 dias. Quedan intent, direccion, modelo, tokens, latencia, confianza,
  --    y del interprete la accion y el resultado (codigos). La propuesta lleva la evidencia
  --    literal del escrito y el rechazo puede llevar el error de JSON.parse con un trozo del
  --    texto: se van con el telefono.
  update public.wa_message_log
     set phone = null,
         message_preview = null,
         interprete_propuesta = null,
         interprete_rechazo = null
   where created_at < v_ahora - interval '90 days'
     and (phone is not null or message_preview is not null
          or interprete_propuesta is not null or interprete_rechazo is not null);
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
$function$;

-- Igual que 20260915060000: nadie la llama por RPC, la corre pg_cron como su dueño.
revoke all on function public.purgar_registros_bot() from public, anon, authenticated, service_role;
