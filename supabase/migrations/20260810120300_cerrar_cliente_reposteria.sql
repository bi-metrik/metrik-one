-- Las 5 tablas de `cliente_reposteria` dejan de estar abiertas a `anon` y `authenticated`.
--
-- Hallazgo lateral del barrido de grants del 2026-08-10, fuera del brief de ese frente: este
-- schema arrastraba el mismo default permisivo que `public` (juego propio de ALTER DEFAULT
-- PRIVILEGES concediendo `arwdDxtm` a anon/authenticated) y ademas **ninguna de sus 5 tablas
-- tenia RLS**. En `public` no quedaba ni una en ese estado; aqui estaban las cinco.
--
-- Datos reales al cerrarlo: `productos` 14 filas; `contactos`, `conversaciones`, `mensajes` y
-- `pedidos` vacias. Nada en el repo de ONE ni en el de MeTRIK referencia este schema.
--
-- QUE PASA CON QUIEN LO CONSUMA. `service_role` bypasea RLS y grants, asi que cualquier
-- proceso server-side (el caso normal de un bot conversacional) sigue funcionando sin cambio.
-- Lo que se corta es el acceso con la anon key del browser y con el token de un usuario
-- cualquiera de ONE, que no tenian por que alcanzar el schema de otro producto.
--
-- Revertir, si aparece un consumidor legitimo con anon key, es simetrico:
--   alter table cliente_reposteria.<t> disable row level security;
--   grant select on cliente_reposteria.<t> to anon;
-- Preferible a eso: darle una policy y dejar el RLS puesto.
--
-- server-only: no se crea ninguna tabla aqui; la marca es para la guarda, que lee el archivo
-- completo y no distingue un CREATE de un ALTER en tablas ya existentes.

alter table cliente_reposteria.contactos      enable row level security;
alter table cliente_reposteria.conversaciones enable row level security;
alter table cliente_reposteria.mensajes       enable row level security;
alter table cliente_reposteria.pedidos        enable row level security;
alter table cliente_reposteria.productos      enable row level security;

revoke all on all tables in schema cliente_reposteria from anon, authenticated;
revoke all on all sequences in schema cliente_reposteria from anon, authenticated;
revoke usage on schema cliente_reposteria from anon, authenticated;

-- Comprobacion sobre el estado real, no sobre lo que la migracion dice haber hecho.
do $$
declare sin_rls int; con_grant int;
begin
  select count(*) into sin_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'cliente_reposteria' and c.relkind in ('r','p') and not c.relrowsecurity;

  select count(*) into con_grant
  from information_schema.role_table_grants
  where table_schema = 'cliente_reposteria' and grantee in ('anon','authenticated');

  if sin_rls > 0 then
    raise exception 'Quedaron % tablas de cliente_reposteria sin RLS', sin_rls;
  end if;
  if con_grant > 0 then
    raise exception 'Quedaron % grants de cliente_reposteria para anon/authenticated', con_grant;
  end if;
end $$;
