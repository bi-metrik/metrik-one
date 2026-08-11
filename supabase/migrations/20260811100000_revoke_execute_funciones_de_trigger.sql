-- Las funciones de trigger dejan de ser ejecutables por PUBLIC, `anon` y `authenticated`.
--
-- Continuacion del frente de grants del 2026-08-10. Alli quedo cerrado el default de tablas,
-- y quedo constancia de que el de funciones **no es corregible**: el `EXECUTE` a PUBLIC es
-- comportamiento nativo de PostgreSQL, vive fuera de `pg_default_acl` y ALTER DEFAULT
-- PRIVILEGES no lo alcanza. Para funciones, el REVOKE explicito es el unico mecanismo. Esta
-- migracion lo aplica al grupo donde es demostrablemente gratis: las funciones de trigger.
--
-- ALCANCE: **48 funciones**, todas `returns trigger`. Medido el 2026-08-11: 23 son
-- `SECURITY DEFINER` (`fn_notif_*`, `sync_*`, `assign_*`, `avisar_entrada_etapa`...) y 25 no
-- lo son (`set_updated_at`, `update_updated_at_column`, `trg_*_auto_codigo`...). El pendiente
-- hablaba solo de las 23; el criterio que importa no es `SECURITY DEFINER`, es **retornar
-- `trigger`**: ninguna de las 48 se puede invocar util­mente por RPC, y PostgREST ni siquiera
-- expone funciones que retornan `trigger`. Cerrar solo las 23 habria dejado la mitad del grupo
-- abierta por una distincion que no viene al caso.
--
-- POR QUE NO ROMPE NADA, verificado y no razonado. La duda legitima era si PostgreSQL exige
-- `EXECUTE` sobre la funcion al **disparar** el trigger. No lo exige. Comprobado en esta base
-- con una tabla, una funcion `SECURITY DEFINER` y un trigger propios: tras revocar EXECUTE a
-- PUBLIC, `anon` y `authenticated`, con `has_function_privilege('authenticated', f, 'execute')`
-- devolviendo **false**, el INSERT como `authenticated` se completo, el trigger corrio, modifico
-- la fila y escribio en su tabla de log. El privilegio se exige al CREAR el trigger, no al
-- dispararlo.
--
-- Antecedente que apunta al mismo sitio: el PR #15 ya habia revocado `authenticated` en 21
-- triggers puros sin consecuencias. Esto lo completa y agrega PUBLIC, que era el que de verdad
-- dejaba la puerta abierta (`revoke ... from anon` a secas no basta, gotcha #185).
--
-- NO se tocan `current_user_workspace_id`, `get_user_role` ni `is_admin_or_owner`. No son
-- triggers y este barrido no las alcanza, pero conviene dejarlo escrito: 217 policies invocan
-- la primera, y sin sesion ya devuelve NULL, que es lo que hace que la policy niegue.
--
-- Se revoca por criterio y no por lista de 48 nombres a proposito: la lista se copia mal, el
-- criterio no. La comprobacion final cuenta sobre el catalogo, no sobre lo que se ejecuto.

do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_function_result(p.oid) = 'trigger'
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.firma);
    n := n + 1;
  end loop;
  raise notice 'EXECUTE revocado en % funciones de trigger', n;
end $$;

-- Comprobacion sobre el catalogo: ninguna funcion de trigger debe quedar alcanzable.
do $$
declare quedan int; nombres text;
begin
  select count(*), coalesce(string_agg(p.proname, ', ' order by p.proname), '')
    into quedan, nombres
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.prokind = 'f'
    and pg_get_function_result(p.oid) = 'trigger'
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
      or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  if quedan > 0 then
    raise exception 'Quedaron % funciones de trigger ejecutables sin sesion: %', quedan, nombres;
  end if;
end $$;
