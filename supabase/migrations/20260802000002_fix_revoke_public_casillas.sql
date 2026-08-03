-- FIX de seguridad de la migración anterior (20260802000001).
--
-- QUÉ PASÓ
-- `sembrar_casillas_bloque` es `SECURITY DEFINER` y escribe filas. Se le puso
-- `revoke all ... from anon, authenticated`, y aun así `has_function_privilege('anon', …)`
-- devolvía TRUE al verificar tras aplicar.
--
-- POR QUÉ
-- En Postgres, toda función nace con `EXECUTE` concedido a **PUBLIC**. Revocar de `anon`
-- no quita ese privilegio: `anon` lo sigue heredando por ser miembro de PUBLIC. El revoke
-- parecía suficiente y no lo era — un no autenticado podía invocar, con permisos de
-- definer, una función que INSERTA filas en `negocio_bloques` para cualquier negocio.
--
-- Es el mismo patrón que ya está documentado para tablas ("toda tabla nueva nace con
-- privilegios para anon; la convención da falsa seguridad"), aplicado a funciones.
--
-- REGLA: en una función `SECURITY DEFINER` que escribe, revocar de **PUBLIC** primero y
-- después conceder solo a quien deba. Y comprobarlo con `has_function_privilege`, no dar
-- por hecho que el revoke alcanzó.

revoke all on function sembrar_casillas_bloque(uuid) from public, anon, authenticated;
revoke all on function trg_sembrar_casillas_bloque() from public, anon, authenticated;

-- `bloque_nace_completo` es una función pura de diagnóstico (no escribe, no lee datos):
-- se le quita a `anon` igual, por higiene, pero no es la que abría el hueco.
revoke all on function bloque_nace_completo(text, boolean, jsonb) from public, anon;

-- Nadie la invoca desde la app: el disparo es el trigger, que corre con los permisos del
-- dueño de la tabla. `service_role` bypasea de todos modos.
