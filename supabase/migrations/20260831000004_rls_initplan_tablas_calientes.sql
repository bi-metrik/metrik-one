-- RLS a InitPlan: tablas calientes (Fase 1a del análisis de rendimiento 2026-08-31)
-- proyectos/soena/ve/2026-08-31_analisis-rendimiento-plataforma.md
--
-- Problema: current_user_workspace_id() consulta profiles y las políticas la invocaban
-- desnuda, por lo que Postgres puede evaluarla POR FILA cuando la qual cae en un Filter
-- (5,6 millones de seq scans medidos sobre profiles en 34 días). Envuelta en (SELECT ...)
-- se vuelve InitPlan: una sola evaluación por query.
-- La lógica de cada política queda EXACTAMENTE igual; solo cambia la forma de evaluación.
-- Respaldo previo en public.backup_rls_policies_20260831 (242 políticas).

-- Igualdad simple sobre workspace_id
alter policy activity_log_workspace_isolation on public.activity_log
  using (workspace_id = (select current_user_workspace_id()));

alter policy bloque_configs_workspace_isolation on public.bloque_configs
  using (workspace_id = (select current_user_workspace_id()));

alter policy cobros_ws on public.cobros
  using (workspace_id = (select current_user_workspace_id()));

alter policy contactos_ws on public.contactos
  using (workspace_id = (select current_user_workspace_id()));

alter policy facturas_ws on public.facturas
  using (workspace_id = (select current_user_workspace_id()));

alter policy gastos_ws on public.gastos
  using (workspace_id = (select current_user_workspace_id()));

alter policy horas_ws on public.horas
  using (workspace_id = (select current_user_workspace_id()));

alter policy negocios_workspace_isolation on public.negocios
  using (workspace_id = (select current_user_workspace_id()));

alter policy profiles_select on public.profiles
  using (workspace_id = (select current_user_workspace_id()));

alter policy staff_ws on public.staff
  using (workspace_id = (select current_user_workspace_id()));

alter policy lineas_negocio_read_global on public.lineas_negocio
  using (workspace_id is null or workspace_id = (select current_user_workspace_id()));

alter policy ws_select on public.workspaces
  using (id = (select current_user_workspace_id()));

alter policy ws_update on public.workspaces
  using (id = (select current_user_workspace_id()));

alter policy notificaciones_insert_same_workspace on public.notificaciones
  with check (workspace_id = (select current_user_workspace_id()));

-- Políticas con EXISTS: la envoltura va en la llamada interna
alter policy negocio_bloques_workspace_isolation on public.negocio_bloques
  using (exists (
    select 1 from public.negocios n
    where n.id = negocio_bloques.negocio_id
      and n.workspace_id = (select current_user_workspace_id())
  ));

alter policy negocio_responsables_read on public.negocio_responsables
  using (exists (
    select 1 from public.negocios n
    where n.id = negocio_responsables.negocio_id
      and n.workspace_id = (select current_user_workspace_id())
  ));

alter policy negocio_responsables_write on public.negocio_responsables
  using (exists (
    select 1 from public.negocios n
    where n.id = negocio_responsables.negocio_id
      and n.workspace_id = (select current_user_workspace_id())
  ))
  with check (exists (
    select 1 from public.negocios n
    where n.id = negocio_responsables.negocio_id
      and n.workspace_id = (select current_user_workspace_id())
  ));

alter policy etapas_negocio_read on public.etapas_negocio
  using (exists (
    select 1 from public.lineas_negocio ln
    where ln.id = etapas_negocio.linea_id
      and (ln.workspace_id is null or ln.workspace_id = (select current_user_workspace_id()))
  ));

alter policy etapas_negocio_update_workspace on public.etapas_negocio
  using (exists (
    select 1 from public.lineas_negocio ln
    where ln.id = etapas_negocio.linea_id
      and ln.workspace_id = (select current_user_workspace_id())
  ))
  with check (exists (
    select 1 from public.lineas_negocio ln
    where ln.id = etapas_negocio.linea_id
      and ln.workspace_id = (select current_user_workspace_id())
  ));
