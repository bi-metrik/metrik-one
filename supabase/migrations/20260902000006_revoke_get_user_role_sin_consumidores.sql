-- ============================================================
-- `get_user_role()` deja de ser alcanzable desde el cliente
--
-- ## LA PREMISA QUE NO SE SOSTENIA
--
-- Tres migraciones seguidas la excluyeron de sus barridos con la misma frase:
--
--   20260810120200: "NO se tocan `current_user_workspace_id`, `get_user_role` ni
--                    `is_admin_or_owner`: 182 de las 201 policies RLS las invocan (...)
--                    Sin sesion ya devuelven NULL, y ese NULL es lo que hace que la policy
--                    niegue. Revocarlas debilita RLS, no lo refuerza."
--   20260811100000: repite la exclusion de las tres.
--   20260630000001: las conserva para `authenticated` en el lote de 24.
--
-- El argumento es CORRECTO, y es correcto de un CONJUNTO. Se heredo como si fuera cierto
-- de cada miembro. Desglosado hoy contra produccion:
--
--   current_user_workspace_id   226 policies   <- explica sola las "182 de 201"
--   is_admin_or_owner             1 policy
--   get_user_role                 0 policies
--
-- `get_user_role` viajo de polizon en esa frase. Ninguna policy la invoca, asi que el
-- argumento de "revocarla debilita RLS" no le aplica: no hay RLS que debilitar.
--
-- ## USO REAL: CERO, POR SIETE VIAS
--
--   repo          0 en `src/`, `supabase/functions/` y `scripts/`.
--                 ⚠️ Su unica aparicion en `src/` es `src/types/database.ts`, AUTOGENERADO,
--                 que lista todas las funciones de la base: contarlo da un falso
--                 "tiene consumidor" para cualquiera.
--   catalogo      0 policies, 0 vistas, 0 funciones, 0 triggers, 0 crons, 0 constraints.
--   pg_depend     0 dependientes.
--   ejecucion     JAMAS invocada en pg_stat_statements, ni por `postgres`. En la misma
--                 ventana `cleanup_expired_bloque_locks` acumula 138 llamadas, o sea que el
--                 instrumento si registra funciones de esta clase: el cero es informativo.
--
-- La ventana de pg_stat_statements cubre 34 h (stats_reset 2026-08-31 16:28), asi que no
-- descarta un uso externo esporadico -- un query manual, el dashboard. Lo que cubre el
-- tiempo largo es que ningun codigo del repo la nombra.
--
-- ## QUE SE GANA, SIN INFLARLO
--
-- Poco, y conviene decirlo: la funcion NO filtra nada. Es `where profile_id = auth.uid()`,
-- asi que con sesion devuelve el rol del PROPIO usuario y sin sesion devuelve NULL
-- (verificado ejecutandola como `anon`). No hay fuga cross-tenant. Se revoca porque una
-- SECURITY DEFINER sin un solo consumidor no tiene por que estar expuesta, no porque
-- hubiera un incidente.
--
-- ## ⚠️ LO QUE ESTE REVOKE NO ARREGLA
--
-- El dano plausible de esta funcion no es el privilegio: es su NOMBRE. Devuelve
-- `staff.rol_plataforma` (medido: 52 staff en `ejecutor` 30, `dueno` 14, `supervisor` 6,
-- `administrador` 2), NO el `profiles.role` que usa la aplicacion (`operator`, `owner`,
-- `admin`). Una autorizacion escrita con ella no coincide nunca... salvo con `supervisor`,
-- el unico valor donde los dos vocabularios se cruzan: o sea que pasaria la prueba y
-- fallaria en produccion. Lo dejo escrito porque **este revoke no lo evita**: las policies
-- RLS se evaluan con los privilegios del PROPIETARIO, no del invocador, asi que una policy
-- que la llame funcionaria igual sin que `authenticated` tenga EXECUTE. El helper correcto
-- es `current_user_profile_role()` (3 policies ya lo usan), creado por 20260730000010 justo
-- para esto.
--
-- Se decidio revocar y NO borrar. La alternativa medida era `drop function` -- ensayado con
-- rollback, sale limpio y sin dependencias, y la definicion para revertir esta en
-- `20260330000000_roles_98g_schema.sql:68` -- pero conservarla es la decision tomada.
--
-- ## QUE NO SE TOCA
--
-- `current_user_workspace_id` (226 policies) e `is_admin_or_owner` (1) conservan PUBLIC y
-- `anon`, y deben conservarlos: sin sesion devuelven NULL y ese NULL es lo que hace que la
-- policy niegue. Revocarlas debilitaria el aislamiento. La frase de las tres migraciones
-- sigue siendo correcta para ellas dos.
--
-- No toca ninguna fila de datos ni la definicion de la funcion: solo el privilegio.
-- ============================================================

revoke execute on function public.get_user_role() from public, anon, authenticated;


-- ── Guarda: el estado final se comprueba, no se supone ─────────────────────

do $$
begin
  if has_function_privilege('anon', 'public.get_user_role()', 'execute') then
    raise exception 'ABORTA: anon conserva EXECUTE sobre get_user_role() (revocar PUBLIC no basto)';
  end if;
  if has_function_privilege('authenticated', 'public.get_user_role()', 'execute') then
    raise exception 'ABORTA: authenticated conserva EXECUTE sobre get_user_role()';
  end if;
  if not has_function_privilege('postgres', 'public.get_user_role()', 'execute') then
    raise exception 'ABORTA: postgres perdio EXECUTE sobre get_user_role()';
  end if;

  -- Las otras dos del trio NO se tocan: si perdieran anon, las policies dejarian de negar.
  if not has_function_privilege('anon', 'public.current_user_workspace_id()', 'execute')
     or not has_function_privilege('anon', 'public.is_admin_or_owner()', 'execute') then
    raise exception 'ABORTA: el revoke alcanzo a current_user_workspace_id o is_admin_or_owner';
  end if;
end $$;
