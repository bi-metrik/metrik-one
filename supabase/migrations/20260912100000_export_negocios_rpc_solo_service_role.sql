-- Cierra el EXECUTE de `authenticated` sobre las dos RPC del archivo de Drive de negocios.
--
-- Que paso. La migracion 20260910120000 revoco `from public, anon` y creyo con eso dejar las
-- funciones solo para `service_role`. No: en este proyecto el rol `authenticated` tiene EXECUTE
-- por los privilegios por defecto del esquema `public`, y `revoke ... from public` NO se lo
-- quita, porque su permiso no viene de PUBLIC sino de una concesion propia. Medido en
-- produccion el 2026-09-12, antes de esta migracion:
--
--   proacl = {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   has_function_privilege('authenticated', ..., 'execute') = true
--
-- Que tan grave era. Poco, pero no cero: las dos funciones son `security invoker`, asi que la
-- RLS de `workspaces` seguia aplicando y nadie podia tocar un workspace ajeno. Lo que si podia
-- hacer una sesion de usuario con permiso de escritura sobre su propio workspace era soltar o
-- pisar el `file_id` sin pasar por la server action, que es la unica que sabe crear el archivo
-- en Drive y compartirlo. El resultado seria una hoja huerfana y un enlace muerto en la UI.
--
-- Estas funciones solo las llama el servidor con la service role. Ningun cliente del navegador
-- las invoca, asi que revocar no rompe nada en la app.
--
-- Migracion de PERMISOS: no crea ni modifica objetos y no toca una sola fila de datos.

revoke execute on function reclamar_export_negocios_file_id(uuid, text) from public, anon, authenticated;
revoke execute on function soltar_export_negocios_file_id(uuid, text)   from public, anon, authenticated;

grant execute on function reclamar_export_negocios_file_id(uuid, text) to service_role;
grant execute on function soltar_export_negocios_file_id(uuid, text)   to service_role;
