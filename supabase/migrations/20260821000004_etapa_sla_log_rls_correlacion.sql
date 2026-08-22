-- ============================================================
-- 20260821000004_etapa_sla_log_rls_correlacion
-- ============================================================
-- Las dos politicas de `etapa_sla_log` nacieron (20260519000002) con
-- `p.workspace_id = workspace_id` dentro del EXISTS. Ese `workspace_id`
-- suelto NO apunta a la fila evaluada: la resolucion de nombres de
-- PostgreSQL lo liga primero al alcance mas interno, y `profiles` tiene
-- una columna con ese nombre. La base lo guardo como
-- `p.workspace_id = p.workspace_id` — una columna comparada consigo
-- misma, siempre cierta. Es el error de correlacion clasico, no una
-- decision.
--
-- NO hubo hueco de aislamiento, y conviene decirlo con precision:
--   * el predicado externo `workspace_id = current_user_workspace_id()`
--     ya acota la fila al workspace del usuario;
--   * `profiles.id` es PK, asi que el EXISTS resuelve exactamente una
--     fila: la del propio usuario;
--   * `current_user_workspace_id()` ES `select workspace_id from profiles
--     where id = auth.uid()`, de modo que `p.workspace_id` y el
--     `workspace_id` de la fila ya son el mismo valor por transitividad.
-- O sea que la condicion correcta estaba IMPLICADA por el resto del
-- predicado: esta migracion no cambia una sola fila de lo que hoy se
-- puede leer o escribir. Lo que cambia es que el control deja de ser una
-- tautologia — una comprobacion que se lee como comprobacion y no
-- comprueba nada es la clase de linea que sobrevive intacta al dia en que
-- alguien toque el predicado externo o la funcion helper.
--
-- MEDIDO contra produccion (ensayo en transaccion con `rollback`, no
-- razonado): se contaron las filas visibles para los 43 perfiles de la
-- base, uno por uno, con `set local role authenticated` y el claim `sub`
-- de cada quien, ANTES y DESPUES de la correccion, con `discard plans`
-- entre medio para no leer un plan cacheado con las policies viejas.
-- Resultado: 43 perfiles medidos, **0 cambian**; 18 filas visibles antes
-- y 18 despues. Y lo que hace valida la prueba: **6 perfiles ven algo**
-- (las 3 filas del log cada uno) y 37 ven cero — sin ese 6, un 0 = 0
-- solo diria que nadie estaba mirando.
--
-- Se reescriben las politicas completas (drop + create) para que la
-- definicion vigente quede legible en un solo lugar, conservando:
--   * el `(select auth.uid())` envuelto del PR #347 (InitPlan), y
--   * la MISMA lista de roles de cada politica, sin agregar ni quitar a
--     nadie.
--
-- ⚠️ ORDEN DE MERGE: esta migracion asume que el PR #347
-- (20260821000003_rls_auth_uid_initplan) ya entro. Si #347 se mergea
-- DESPUES, sus `alter policy` sobre estas dos politicas reinstalan la
-- tautologia — hay que quitar de #347 los dos bloques de `etapa_sla_log`
-- o volver a aplicar esta.
--
-- Nota aparte, no se toca: la politica de INSERT se llama
-- `..._owner_admin` pero su lista de roles incluye `supervisor` desde el
-- origen, y eso coincide con el permiso de la aplicacion
-- (`canViewSlaLog` / edicion de SLA = owner, admin, supervisor).
-- El nombre miente, el predicado no. Renombrarla es churn sin efecto y
-- se deja documentado en vez de cambiado.
-- ============================================================

-- SELECT: owner/admin/supervisor del workspace
drop policy if exists "etapa_sla_log_select_owner_admin_supervisor" on public.etapa_sla_log;
create policy "etapa_sla_log_select_owner_admin_supervisor"
  on public.etapa_sla_log
  for select
  to authenticated
  using (
    workspace_id = public.current_user_workspace_id()
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.workspace_id = etapa_sla_log.workspace_id
        and p.role in ('owner', 'admin', 'supervisor')
    )
  );

-- INSERT: lo escribe la server action `updateEtapaSla` con el cliente
-- authenticated, asi que esta politica es la barrera real.
drop policy if exists "etapa_sla_log_insert_owner_admin" on public.etapa_sla_log;
create policy "etapa_sla_log_insert_owner_admin"
  on public.etapa_sla_log
  for insert
  to authenticated
  with check (
    workspace_id = public.current_user_workspace_id()
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.workspace_id = etapa_sla_log.workspace_id
        and p.role in ('owner', 'admin', 'supervisor')
    )
  );

comment on policy "etapa_sla_log_insert_owner_admin" on public.etapa_sla_log is
  'Pese al nombre, admite owner/admin/supervisor — igual que la de SELECT y que el permiso canViewSlaLog de la aplicacion.';
