#!/usr/bin/env node
// Imprime el dry-run de `20261026220000_funciones_puerta_cerrada.sql`: el ARCHIVO tal cual, dentro de un `DO $dry$`
// que mide antes, corre la migración entera, prueba guardar y leer una ficha con la puerta marcada y termina en
// `raise exception 'DRYRUN OK {...}'`, así que nada queda escrito. Aborta si falta el módulo de funciones
// (20261022170000_modulo_funciones.sql), si la columna ya existe o si no hay un perfil del equipo con el que firmar.
//
// No se conecta a nada: solo arma el texto. Lo corre la sesión principal contra producción (MCP execute_sql o la
// Management API), como un solo statement. Las pruebas lo corren en PGlite (`puerta-cerrada-sql.test.ts`).
//
//   node scripts/funciones-puerta-cerrada-dry-run.mjs > /tmp/dry-run-puerta-cerrada.sql
//
// La prueba de guardar firma como el primer perfil del equipo (owner/admin/supervisor/operator, por id) poniendo
// `request.jwt.claims` y `request.jwt.claim.sub` (y `prueba.uid`, el de PGlite) SOLO dentro de la transacción. Las
// experiencias y la campaña que crea se van con el raise.
//
// Resultado esperado (en el mensaje del error; jsonb ordena las llaves):
//   DRYRUN OK {"panel_anon": false, "guardar_anon": false, "filas_iguales": true, "guardada_true": true,
//              "grants_iguales": true, "columna_not_null": true, "panel_service_role": false, "panel_authenticated": true,
//              "panel_devuelve_true": true, "guardar_service_role": false, "columna_default_false": true,
//              "guardar_authenticated": true, "sin_llave_queda_false": true, "workspaces_con_modulo": 0,
//              "llave_no_booleana_rechazada": true}
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const archivo = readFileSync(join(process.cwd(), 'supabase/migrations/20261026220000_funciones_puerta_cerrada.sql'), 'utf8')
if (archivo.includes('$mig$') || archivo.includes('$dry$')) {
  console.error('La migración contiene $mig$ o $dry$: no se puede envolver.')
  process.exit(1)
}

const GUARDAR = `'public.funcion_guardar_experiencia(uuid, uuid, jsonb)'::regprocedure`
const PANEL = `'public.funcion_panel_campana(uuid)'::regprocedure`
const ACL = `(select string_agg(p.proname || '=' || coalesce(p.proacl::text, 'null'), ' ' order by p.proname)
                 from pg_proc p where p.oid in (${GUARDAR}, ${PANEL}))`

process.stdout.write(`do $dry$
declare
  r jsonb;
  acl_antes text;
  filas_antes text;
  filas_despues text;
  v_uid uuid;
  v_ws uuid;
  v_exp uuid;
  v_exp2 uuid;
  v_camp uuid := gen_random_uuid();
  v_panel jsonb;
  v_rechazo text := 'no rechazó';
begin
  if to_regprocedure('public.funcion_guardar_experiencia(uuid, uuid, jsonb)') is null
     or to_regprocedure('public.funcion_panel_campana(uuid)') is null then
    raise exception 'DRYRUN ABORTA: falta el módulo de funciones (aplicar antes 20261022170000_modulo_funciones)';
  end if;
  if exists (select 1 from pg_attribute where attrelid = 'public.funcion_experiencias'::regclass
              and attname = 'puerta_cerrada' and not attisdropped) then
    raise exception 'DRYRUN ABORTA: la columna puerta_cerrada ya existe (¿ya se aplicó?)';
  end if;
  select p.id, p.workspace_id into v_uid, v_ws from public.profiles p
   where p.workspace_id is not null and p.role in ('owner', 'admin', 'supervisor', 'operator')
   order by p.id limit 1;
  if v_uid is null then
    raise exception 'DRYRUN ABORTA: no hay un perfil del equipo con el que firmar la prueba de guardar';
  end if;
  acl_antes := ${ACL};
  select (select count(*) from public.funcion_experiencias) || '/' || (select count(*) from public.funcion_campanas)
    into filas_antes;

  execute $mig$
${archivo}
$mig$;

  -- Filas reales: se cuentan antes de crear las de la prueba.
  select (select count(*) from public.funcion_experiencias) || '/' || (select count(*) from public.funcion_campanas)
    into filas_despues;

  -- Guardar una ficha con la puerta marcada, firmando como el equipo (solo en esta transacción).
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  perform set_config('prueba.uid', v_uid::text, true);
  v_exp := public.funcion_guardar_experiencia(v_ws, null, '{"nombre": "DRYRUN puerta", "puerta_cerrada": true}'::jsonb);
  v_exp2 := public.funcion_guardar_experiencia(v_ws, null, '{"nombre": "DRYRUN sin puerta"}'::jsonb);
  begin
    perform public.funcion_guardar_experiencia(v_ws, null, '{"nombre": "DRYRUN mala", "puerta_cerrada": "si"}'::jsonb);
  exception when others then
    v_rechazo := sqlerrm;
  end;
  insert into public.funcion_campanas (id, workspace_id, experiencia_id, nombre, codigo)
  values (v_camp, v_ws, v_exp, 'DRYRUN puerta', 'DRYRUN-PUERTA');
  v_panel := public.funcion_panel_campana(v_camp);

  select jsonb_build_object(
    'columna_default_false', (select pg_get_expr(a.adbin, a.adrelid) from pg_attrdef a
                                join pg_attribute c on c.attrelid = a.adrelid and c.attnum = a.adnum
                               where a.adrelid = 'public.funcion_experiencias'::regclass and c.attname = 'puerta_cerrada') = 'false',
    'columna_not_null', (select attnotnull from pg_attribute where attrelid = 'public.funcion_experiencias'::regclass
                          and attname = 'puerta_cerrada'),
    'grants_iguales', acl_antes = ${ACL},
    'guardar_anon', has_function_privilege('anon', ${GUARDAR}, 'execute'),
    'guardar_authenticated', has_function_privilege('authenticated', ${GUARDAR}, 'execute'),
    'guardar_service_role', has_function_privilege('service_role', ${GUARDAR}, 'execute'),
    'panel_anon', has_function_privilege('anon', ${PANEL}, 'execute'),
    'panel_authenticated', has_function_privilege('authenticated', ${PANEL}, 'execute'),
    'panel_service_role', has_function_privilege('service_role', ${PANEL}, 'execute'),
    'guardada_true', (select puerta_cerrada from public.funcion_experiencias where id = v_exp),
    'sin_llave_queda_false', (select puerta_cerrada from public.funcion_experiencias where id = v_exp2) = false,
    'llave_no_booleana_rechazada', v_rechazo = 'datos_invalidos',
    'panel_devuelve_true', (v_panel->'experiencia'->'puerta_cerrada') = 'true'::jsonb,
    'filas_iguales', filas_antes = filas_despues,
    'workspaces_con_modulo', (select count(*) from public.workspace_modulos where modulo = 'funciones')
  ) into r;
  raise exception 'DRYRUN OK %', r;
end $dry$;
`)
