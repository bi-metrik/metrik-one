-- Lo que nace nuevo deja de nacer concedido. Cambia el DEFAULT, no solo lo ya creado.
--
-- Las dos migraciones anteriores de esta tanda limpian el inventario actual. Esta ataca la
-- causa: mientras el default no cambie, la proxima tabla vuelve a nacer con los siete
-- privilegios para `anon` y `authenticated`, y el hueco se reabre solo. El 2026-08-09/10 seis
-- respaldos `CREATE TABLE ... AS SELECT` nacieron asi (uno con 173 filas de negocios) sin que
-- nadie hiciera nada mal: escribir un respaldo antes de migrar datos es la buena practica.
--
-- ALTER DEFAULT PRIVILEGES aplica **por rol creador**, no globalmente. Medido el 2026-08-10,
-- esta base tiene default ACLs en `public` para DOS roles (`postgres` y `supabase_admin`) mas
-- un juego propio en el schema `cliente_reposteria`. Se intentan los cuatro cruces; los de
-- `supabase_admin` fallan con "permission denied to change default privileges" incluso siendo
-- `postgres` (comprobado en ensayo con rollback), asi que la migracion los reporta como
-- warning en vez de abortar. En la practica no importa hoy: las migraciones de ONE las crea
-- `postgres`, y es su default el que gobierna lo que nace.
--
-- QUE CAMBIA
--
-- Tablas y secuencias: nada por defecto, ni para `anon` ni para `authenticated`. Es la
-- convencion que CLAUDE.md ya declara desde 2026-06-02 ("GRANT explicito al rol que la
-- consume") y que hasta hoy el default contradecia en silencio. Ademas Supabase la impone
-- igual el 2026-10-30 para tablas nuevas de proyectos existentes: adoptarla ahora es llegar
-- preparado en vez de descubrirlo con una tabla invisible en produccion.
--
-- Verificado en ensayo: una tabla creada despues de esto nace con
-- `postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres` y nada mas.
--
-- CONSECUENCIA DIRECTA: **toda migracion que cree una tabla consumida por el cliente debe
-- incluir su `grant ... to authenticated`.** Si se olvida, la tabla queda invisible para
-- PostgREST aunque el RLS sea perfecto. Contra ese olvido va la guarda de CI
-- (`scripts/check-migracion-grants.mjs`), que falla el PR antes de que llegue a la base.
--
-- QUE NO SE PUEDE CAMBIAR, Y POR QUE NO SE FINGE QUE SI
--
-- **Las funciones nuevas seguiran naciendo ejecutables por `anon`. No hay forma de evitarlo
-- desde aqui.** Toda funcion nace con EXECUTE para PUBLIC por comportamiento nativo de
-- PostgreSQL, ese default vive fuera de `pg_default_acl`, y ALTER DEFAULT PRIVILEGES no lo
-- alcanza. Medido en esta base, en ensayo con rollback:
--
--   * `revoke execute on functions from public` no modifica `pg_default_acl` en absoluto.
--   * Forzando la materializacion (`grant` a PUBLIC y luego `revoke`) el default SI pierde
--     la entrada `=X/`, y aun asi la funcion creada despues vuelve a nacer con `=X/postgres`.
--   * Tras revocar `anon` del default, una funcion nueva nace sin `anon=X` y sin embargo
--     `has_function_privilege('anon', f, 'execute')` sigue devolviendo **true**: `anon` la
--     alcanza como miembro de PUBLIC.
--
-- Por eso esta migracion NO incluye un revoke de funciones: habria quedado un comando inutil
-- con aspecto de proteccion, que es peor que no tenerlo. La unica via real es el REVOKE
-- explicito en la migracion que crea cada funcion, y de eso se encarga la guarda de CI, que
-- tambien revisa funciones.
--
-- NO se tocan `current_user_workspace_id`, `get_user_role` ni `is_admin_or_owner`: 182 de las
-- 201 policies RLS las invocan, incluida la del routing por subdominio. Sin sesion ya devuelven
-- NULL, y ese NULL es lo que hace que la policy niegue. Revocarlas debilita RLS, no lo refuerza.

do $$
declare
  r_role text;
  r_schema text;
  fallidos text := '';
begin
  foreach r_role in array array['postgres','supabase_admin'] loop
    foreach r_schema in array array['public','cliente_reposteria'] loop
      begin
        execute format('alter default privileges for role %I in schema %I revoke all on tables from anon, authenticated', r_role, r_schema);
        execute format('alter default privileges for role %I in schema %I revoke all on sequences from anon, authenticated', r_role, r_schema);
      exception when others then
        fallidos := fallidos || format(' [%s/%s: %s]', r_role, r_schema, SQLERRM);
      end;
    end loop;
  end loop;

  if fallidos <> '' then
    raise warning 'Default privileges NO alterados en:%. Esperado para supabase_admin; revisar si aparece postgres.', fallidos;
  end if;
end $$;

-- Comprobacion sobre el resultado real, no sobre lo que la migracion dice haber hecho:
-- se crea una tabla de prueba y se lee su ACL efectivo.
--
-- server-only: `_check_default_privs` es una tabla de verificacion que nace y muere dentro de
-- este mismo bloque, sin datos y sin consumidor. Lleva RLS igual, en vez de pedirle una
-- excepcion a la guarda: la propia migracion que instaura la convencion es el peor sitio
-- posible para saltarsela.
do $$
declare acl_tabla text;
begin
  create table public._check_default_privs (id int);
  alter table public._check_default_privs enable row level security;

  select coalesce(array_to_string(relacl,','), '(sin ACL: nadie concedido)') into acl_tabla
  from pg_class where oid = 'public._check_default_privs'::regclass;

  drop table public._check_default_privs;

  if acl_tabla like '%anon=%' or acl_tabla like '%authenticated=%' then
    raise exception 'Una tabla nueva SIGUE naciendo concedida. ACL: %', acl_tabla;
  end if;

  raise notice 'OK: una tabla nueva nace con ACL %', acl_tabla;
end $$;
