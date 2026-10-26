#!/usr/bin/env node
// Imprime el dry-run de `20261022170000_modulo_funciones.sql`: el ARCHIVO tal cual, dentro de un `DO $dry$` que corre
// la migración entera y termina en `raise exception 'DRYRUN OK {...}'`, así que nada queda escrito. Antes de correrla
// aborta si falta `chatwoot_consentimientos` (la migración depende de 20261021090000_asistente_chatwoot.sql).
//
// No se conecta a nada: solo arma el texto. Lo corre la sesión principal contra producción (MCP execute_sql o la
// Management API), como un solo statement.
//
//   node scripts/funciones-dry-run.mjs > /tmp/dry-run-funciones.sql
//
// Resultado esperado (en el mensaje del error):
//   DRYRUN OK {"rpc": 56, "rpc_anon": 0, "tablas_con_rls": 8, "tablas_de_mesas": 0, "publicar_service_role": false,
//              "resolver_service_role": false, "workspaces_con_modulo": 0, "registrar_authenticated": false,
//              "disponibles_authenticated": false, "saldo_cobrado_service_role": false}
// (56 desde el 25-oct: el saldo, P14, suma 7 funciones; antes eran 49.)
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const archivo = readFileSync(join(process.cwd(), 'supabase/migrations/20261022170000_modulo_funciones.sql'), 'utf8')
if (archivo.includes('$mig$') || archivo.includes('$dry$')) {
  console.error('La migración contiene $mig$ o $dry$: no se puede envolver.')
  process.exit(1)
}

process.stdout.write(`do $dry$
declare r jsonb;
begin
  if to_regclass('public.chatwoot_consentimientos') is null then
    raise exception 'DRYRUN ABORTA: falta chatwoot_consentimientos (aplicar antes 20261021090000_asistente_chatwoot)';
  end if;
  execute $mig$
${archivo}
$mig$;
  select jsonb_build_object(
    'tablas_con_rls', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'funcion\\_%' and relkind = 'r' and relrowsecurity),
    'rpc', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'funcion\\_%'),
    'rpc_anon', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'funcion\\_%' and has_function_privilege('anon', oid, 'execute')),
    'publicar_service_role', has_function_privilege('service_role', 'public.funcion_publicar_agenda(uuid)', 'execute'),
    'disponibles_authenticated', has_function_privilege('authenticated', 'public.funcion_ver_disponibles(uuid, text)', 'execute'),
    'resolver_service_role', has_function_privilege('service_role', 'public.funcion_resolver_pendiente(uuid, text)', 'execute'),
    'registrar_authenticated', has_function_privilege('authenticated', 'public.funcion_registrar_pago(uuid, text, text, bigint)', 'execute'),
    'saldo_cobrado_service_role', has_function_privilege('service_role', 'public.funcion_registrar_saldo_cobrado(uuid, bigint, text)', 'execute'),
    'tablas_de_mesas', (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('funcion_montajes', 'funcion_mesas', 'funcion_reserva_mesas')),
    'workspaces_con_modulo', (select count(*) from public.workspaces where coalesce(modules->'funciones' = 'true'::jsonb, false))
  ) into r;
  raise exception 'DRYRUN OK %', r;
end $dry$;
`)
