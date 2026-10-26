#!/usr/bin/env node
// Imprime el dry-run de `20261026210000_funciones_saldo_plazo_cero.sql`: el ARCHIVO tal cual, dentro de un `DO $dry$`
// que mide antes, corre la migración entera, mide después y termina en `raise exception 'DRYRUN OK {...}'`, así que
// nada queda escrito. Aborta si falta el módulo de funciones (20261022170000_modulo_funciones.sql).
//
// No se conecta a nada: solo arma el texto. Lo corre la sesión principal contra producción (MCP execute_sql o la
// Management API), como un solo statement. Las pruebas lo corren en PGlite (`saldo-plazo-cero-sql.test.ts`).
//
//   node scripts/funciones-saldo-plazo-cero-dry-run.mjs > /tmp/dry-run-saldo-plazo-cero.sql
//
// Los checks se prueban evaluando SU expresión (pg_get_expr) con 0, 1, 30 y 31, sin tocar ninguna fila.
//
// Resultado esperado (en el mensaje del error; jsonb ordena las llaves):
//   DRYRUN OK {"plazo_uno": true, "plazo_cero": true, "default_es_1": true, "guardar_anon": false, "filas_iguales": true,
//              "grants_iguales": true, "checks_campanas": [true, true, true, false], "checks_reservas": [true, true, true, false],
//              "plazo_uno_igual": true, "guardar_solo_rango": true, "plazo_service_role": false, "plazo_authenticated": false,
//              "guardar_service_role": false, "guardar_authenticated": true}
// `checks_*` = acepta [0, 1, 30, 31].
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const archivo = readFileSync(join(process.cwd(), 'supabase/migrations/20261026210000_funciones_saldo_plazo_cero.sql'), 'utf8')
if (archivo.includes('$mig$') || archivo.includes('$dry$')) {
  console.error('La migración contiene $mig$ o $dry$: no se puede envolver.')
  process.exit(1)
}

const PLAZO = `'public.funcion_plazo_saldo(timestamptz, integer)'::regprocedure`
const GUARDAR = `'public.funcion_guardar_campana(uuid, uuid, uuid, text, text, date, date, text, integer, jsonb)'::regprocedure`

process.stdout.write(`do $dry$
declare
  r jsonb;
  t timestamptz := '2026-10-31 20:00:00-05';
  acl_antes text;
  guardar_antes text;
  plazo_uno_antes timestamptz;
  filas_antes text;
  filas_despues text;
  -- Lo que dice el check de una tabla con 0, 1, 30 y 31, sin tocar filas.
  checks_campanas jsonb;
  checks_reservas jsonb;
  expr text;
  v boolean;
  d integer;
begin
  if to_regprocedure('public.funcion_plazo_saldo(timestamptz, integer)') is null
     or to_regprocedure('public.funcion_guardar_campana(uuid, uuid, uuid, text, text, date, date, text, integer, jsonb)') is null then
    raise exception 'DRYRUN ABORTA: falta el módulo de funciones (aplicar antes 20261022170000_modulo_funciones)';
  end if;
  select string_agg(p.proname || '=' || coalesce(p.proacl::text, 'null'), ' ' order by p.proname) into acl_antes
    from pg_proc p where p.oid in (${PLAZO}, ${GUARDAR});
  select prosrc into guardar_antes from pg_proc where oid = ${GUARDAR};
  plazo_uno_antes := public.funcion_plazo_saldo(t, 1);
  select (select count(*) || '/' || coalesce(sum(dias_saldo_antes), 0) from public.funcion_campanas) || ' ' ||
         (select count(*) || '/' || coalesce(sum(dias_saldo_antes), 0) from public.funcion_reservas) into filas_antes;

  execute $mig$
${archivo}
$mig$;

  select (select count(*) || '/' || coalesce(sum(dias_saldo_antes), 0) from public.funcion_campanas) || ' ' ||
         (select count(*) || '/' || coalesce(sum(dias_saldo_antes), 0) from public.funcion_reservas) into filas_despues;
  checks_campanas := '[]'::jsonb;
  select pg_get_expr(conbin, conrelid) into strict expr from pg_constraint
   where conrelid = 'public.funcion_campanas'::regclass and conname = 'funcion_campanas_dias_saldo_antes_check';
  foreach d in array array[0, 1, 30, 31] loop
    execute format('select %s from (select $1::integer as dias_saldo_antes) s', expr) into v using d;
    checks_campanas := checks_campanas || to_jsonb(v);
  end loop;
  checks_reservas := '[]'::jsonb;
  select pg_get_expr(conbin, conrelid) into strict expr from pg_constraint
   where conrelid = 'public.funcion_reservas'::regclass and conname = 'funcion_reservas_dias_saldo_antes_check';
  foreach d in array array[0, 1, 30, 31] loop
    execute format('select %s from (select $1::integer as dias_saldo_antes) s', expr) into v using d;
    checks_reservas := checks_reservas || to_jsonb(v);
  end loop;

  select jsonb_build_object(
    'plazo_cero', public.funcion_plazo_saldo(t, 0) = t,
    'plazo_uno', public.funcion_plazo_saldo(t, 1) = '2026-10-31 00:00:00-05'::timestamptz,
    'plazo_uno_igual', public.funcion_plazo_saldo(t, 1) = plazo_uno_antes,
    'checks_campanas', checks_campanas,
    'checks_reservas', checks_reservas,
    'guardar_solo_rango', replace(guardar_antes, 'not between 1 and 30', 'not between 0 and 30')
                          = (select prosrc from pg_proc where oid = ${GUARDAR})
                          and guardar_antes <> (select prosrc from pg_proc where oid = ${GUARDAR}),
    'grants_iguales', acl_antes = (select string_agg(p.proname || '=' || coalesce(p.proacl::text, 'null'), ' ' order by p.proname)
                                     from pg_proc p where p.oid in (${PLAZO}, ${GUARDAR})),
    'plazo_authenticated', has_function_privilege('authenticated', ${PLAZO}, 'execute'),
    'plazo_service_role', has_function_privilege('service_role', ${PLAZO}, 'execute'),
    'guardar_anon', has_function_privilege('anon', ${GUARDAR}, 'execute'),
    'guardar_authenticated', has_function_privilege('authenticated', ${GUARDAR}, 'execute'),
    'guardar_service_role', has_function_privilege('service_role', ${GUARDAR}, 'execute'),
    'default_es_1', (select pg_get_expr(adbin, adrelid) from pg_attrdef a join pg_attribute c on c.attrelid = a.adrelid and c.attnum = a.adnum
                      where a.adrelid = 'public.funcion_campanas'::regclass and c.attname = 'dias_saldo_antes') = '1',
    'filas_iguales', filas_antes = filas_despues
  ) into r;
  raise exception 'DRYRUN OK %', r;
end $dry$;
`)
