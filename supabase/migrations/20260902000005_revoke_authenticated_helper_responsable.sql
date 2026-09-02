-- ============================================================
-- El helper del aviso de responsable deja de ser ejecutable por `authenticated`
--
-- ## EL DEFECTO
--
-- `debe_alertar_responsable_faltante(uuid)` nacio en 20260901000011 como helper interno:
-- la fuente unica que consultan `detectar_responsable_faltante_area` (para crear el aviso)
-- y `resolver_notificaciones_obsoletas` (para cerrarlo). Es `SECURITY DEFINER`, o sea que
-- responde saltandose el RLS, y recibe el `negocio_id` de quien la llame.
--
-- Se quedo con `EXECUTE` para `authenticated`. Medido en produccion el 2026-09-02:
--
--   debe_alertar_responsable_faltante  {postgres=X,authenticated=X,service_role=X}  auth_exec=TRUE
--   debe_alertar_inactividad           {postgres=X,service_role=X}                  auth_exec=false
--   dias_habiles_sin_actividad         {postgres=X,service_role=X}                  auth_exec=false
--   umbral_inactividad_negocio         {postgres=X,service_role=X}                  auth_exec=false
--   negocios_ultima_actividad          {postgres=X,service_role=X}                  auth_exec=false
--   ultima_actividad_negocio           {postgres=X,service_role=X}                  auth_exec=false
--   resolver_notificaciones_obsoletas  {postgres=X,service_role=X}                  auth_exec=false
--
-- Es la unica de los siete helpers en ese estado, y sus DOS HERMANAS DE LA MISMA MIGRACION
-- (`ultima_actividad_negocio`, `negocios_ultima_actividad`) si nombran `authenticated` en su
-- linea de revoke. Fue una omision al escribir, no una decision.
--
-- Lo que concede: un autenticado de cualquier workspace que tenga un `negocio_id` puede
-- preguntar si ese negocio --de otro tenant-- esta sin el responsable que su stage exige.
-- Es un oraculo de un bit y exige conocer el UUID, asi que no es una fuga masiva: es
-- superficie que no tiene por que existir, del mismo tamano y por la misma razon que la que
-- cerro el PR #481 en `debe_alertar_inactividad`. Se revoca por higiene, no por incendio.
--
-- ## POR QUE EL REVOKE DE LA MIGRACION ORIGINAL NO BASTO
--
-- 20260901000011 hace `revoke ... from public, anon`, que en otras funciones alcanza porque
-- el privilegio de `authenticated` suele llegar HEREDADO de PUBLIC (gotcha #185). Aqui no.
-- Medido: el `ALTER DEFAULT PRIVILEGES` de esta base concede EXECUTE de forma EXPLICITA
-- sobre toda funcion nueva de `public` --
--
--   rol postgres · esquema public · tipo f
--   {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--
-- -- asi que `authenticated=X/postgres` es un grant PROPIO de la funcion, no herencia, y
-- `revoke ... from public` no lo alcanza. Se ve en la ACL: el privilegio sobrevivio al
-- revoke original.
--
-- ⚠️ COROLARIO PARA TODA FUNCION NUEVA DE ESTE REPO: hay que nombrar `authenticated` en el
-- revoke aunque ya se revoque PUBLIC. Revocar PUBLIC solo cierra la herencia; el default
-- explicito de la base hay que revocarlo aparte. La guarda de CI comprueba PUBLIC, no esto.
--
-- ## QUE NO CAMBIA
--
-- `detectar_responsable_faltante_area()` CONSERVA su `grant ... to authenticated`. Viene de
-- 20260630000001 (security ola 2), donde se mantuvo a proposito, y esta migracion no lo
-- revisa: cambiarlo pide su propia medicion.
--
-- Los dos consumidores no se afectan. pg_cron los corre como `postgres`, que es el owner y
-- conserva `postgres=X` en la ACL: jobid 9 `detectar_responsable_faltante_area_diario`
-- (13:00 UTC) y jobid 12 `resolver-notificaciones-obsoletas` (12:45 UTC), ambos `active` y
-- en `succeeded` los ultimos tres dias. Y ningun componente del cliente la invoca: cero
-- ocurrencias de `debe_alertar_responsable_faltante` en `src/`.
--
-- No toca ninguna fila de datos ni ninguna definicion de funcion: solo el privilegio.
-- ============================================================

revoke execute on function public.debe_alertar_responsable_faltante(uuid) from authenticated;


-- ── Guarda: el estado final se comprueba, no se supone ─────────────────────
--
-- Un `revoke` sobre un privilegio que no existe NO falla, asi que el comando corre igual
-- si el objeto es otro del que se cree. Estas tres comprobaciones separan "se aplico" de
-- "se ejecuto": la primera es el objetivo, las otras dos son los consumidores que no se
-- pueden romper.

do $$
begin
  if has_function_privilege('authenticated', 'public.debe_alertar_responsable_faltante(uuid)', 'execute') then
    raise exception 'ABORTA: authenticated conserva EXECUTE sobre debe_alertar_responsable_faltante(uuid)';
  end if;

  if not has_function_privilege('service_role', 'public.debe_alertar_responsable_faltante(uuid)', 'execute') then
    raise exception 'ABORTA: service_role perdio EXECUTE; los consumidores server-side dejarian de resolver';
  end if;

  if not has_function_privilege('postgres', 'public.debe_alertar_responsable_faltante(uuid)', 'execute') then
    raise exception 'ABORTA: postgres perdio EXECUTE; pg_cron corre los dos jobs como postgres';
  end if;
end $$;
