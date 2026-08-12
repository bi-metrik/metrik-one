-- TRUNCATE, REFERENCES y TRIGGER dejan de estar concedidos a anon y authenticated.
--
-- Toda tabla de ONE nace con los SIETE privilegios para `anon` y `authenticated`, por el
-- ALTER DEFAULT PRIVILEGES que trae el proyecto. Medido el 2026-08-10: 135 tablas de `public`
-- con los 7 para `anon`, 146 para `authenticated`.
--
-- De esos siete, TRUNCATE / REFERENCES / TRIGGER no los emite NINGUN cliente de ONE:
-- PostgREST solo genera SELECT/INSERT/UPDATE/DELETE y llamadas RPC, y el resto del producto
-- entra por `service_role` (que bypasea grants). Revocarlos no cambia ningun comportamiento.
--
-- Importan porque TRUNCATE **no pasa por RLS**. Verificado en esta base contra una tabla de
-- prueba con RLS activo y cero policies (deny-all): `anon` no podia leer una sola fila y aun
-- asi ejecuto el TRUNCATE, dejando la tabla en cero. RLS, que es la unica capa que hoy separa
-- a un visitante de los datos, no cubre este caso.
--
-- Calibracion honesta de la urgencia, porque el CLAUDE.md vigente la exagera en dos gotchas
-- ("cualquiera con la anon key del bundle podia vaciar la tabla"): con la anon key sola HOY no
-- se puede. Medido: el rol `anon` es NOLOGIN (no hay conexion directa por wire protocol),
-- PostgREST no expone TRUNCATE por la API REST, y hay CERO funciones ejecutables por `anon`
-- que contengan TRUNCATE. Es superficie latente, no una fuga abierta: se vuelve alcanzable el
-- dia que alguien publique una funcion que trunque. Se cierra por higiene, no por incendio.
--
-- REFERENCES y TRIGGER van en la misma tanda: permiten crear claves foraneas y triggers sobre
-- tablas ajenas, tampoco los usa ningun cliente, y su unico efecto hoy es ensanchar superficie.

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke truncate, references, trigger on all tables in schema cliente_reposteria from anon, authenticated;

-- Comprobacion: falla la migracion si queda una sola tabla con alguno de los tres.
do $$
declare quedan int;
begin
  select count(*) into quedan
  from information_schema.role_table_grants
  where table_schema in ('public','cliente_reposteria')
    and grantee in ('anon','authenticated')
    and privilege_type in ('TRUNCATE','REFERENCES','TRIGGER');
  if quedan > 0 then
    raise exception 'Quedaron % grants de TRUNCATE/REFERENCES/TRIGGER para anon/authenticated', quedan;
  end if;
end $$;
