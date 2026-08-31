-- RLS a InitPlan: resto del esquema public (Fase 1a, parte 2, análisis 2026-08-31)
-- proyectos/soena/ve/2026-08-31_analisis-rendimiento-plataforma.md
--
-- Mismo cambio que 20260831000004 aplicado al resto de políticas: envolver las
-- funciones helper (current_user_workspace_id, calidad_ve_todo_el_piso,
-- current_user_profile_role, current_user_staff_id, is_admin_or_owner, auth.uid,
-- auth.jwt) en (SELECT ...) para que se evalúen una vez por query (InitPlan) en
-- vez de fila por fila. La lógica de cada política queda idéntica.
-- Sentencias generadas mecánicamente desde pg_policies y revisadas una a una.
-- Respaldo previo en public.backup_rls_policies_20260831 (242 políticas).

alter policy activity_menciones_delete on public.activity_menciones
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy activity_menciones_insert on public.activity_menciones
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy activity_menciones_select on public.activity_menciones
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy aliados_rw on public.aliados
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy al_insert on public.audit_log
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy al_select on public.audit_log
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy ba_ws on public.bank_accounts
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy bb_ws on public.bank_balances
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy bloque_correcciones_insert on public.bloque_correcciones
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy bloque_correcciones_select on public.bloque_correcciones
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy bloque_correcciones_update on public.bloque_correcciones
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy bloque_items_workspace_isolation on public.bloque_items
  using ((EXISTS ( SELECT 1
   FROM (negocio_bloques nb
     JOIN negocios n ON ((n.id = nb.negocio_id)))
  WHERE ((nb.id = bloque_items.negocio_bloque_id) AND (n.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy bloque_locks_read on public.bloque_locks
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy bloque_locks_write on public.bloque_locks
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy bs_insert on public.bot_sessions
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy bs_select on public.bot_sessions
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy bs_update on public.bot_sessions
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy calidad_cobertura_dia_select on public.calidad_cobertura_dia
  using (((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)) AND ( SELECT calidad_ve_todo_el_piso() AS calidad_ve_todo_el_piso)));

alter policy calidad_llamadas_select on public.calidad_llamadas
  using (((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)) AND (( SELECT calidad_ve_todo_el_piso() AS calidad_ve_todo_el_piso) OR ((( SELECT current_user_profile_role() AS current_user_profile_role) = 'operator'::text) AND (agente_staff_id = ( SELECT current_user_staff_id() AS current_user_staff_id))))));

alter policy calidad_llamadas_bloques_select on public.calidad_llamadas_bloques
  using (((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)) AND (( SELECT calidad_ve_todo_el_piso() AS calidad_ve_todo_el_piso) OR ((( SELECT current_user_profile_role() AS current_user_profile_role) = 'operator'::text) AND calidad_llamada_es_mia(llamada_id)))));

alter policy calidad_llamadas_hallazgos_select on public.calidad_llamadas_hallazgos
  using (((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)) AND (( SELECT calidad_ve_todo_el_piso() AS calidad_ve_todo_el_piso) OR ((( SELECT current_user_profile_role() AS current_user_profile_role) = 'operator'::text) AND calidad_llamada_es_mia(llamada_id)))));

alter policy calidad_recobro_dia_select on public.calidad_recobro_dia
  using (((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)) AND ( SELECT calidad_ve_todo_el_piso() AS calidad_ve_todo_el_piso)));

alter policy cert_documentos_delete on public.cert_documentos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cert_documentos_insert on public.cert_documentos
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cert_documentos_select on public.cert_documentos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cert_lotes_delete on public.cert_lotes
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cert_lotes_insert on public.cert_lotes
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cert_lotes_select on public.cert_lotes
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cert_lotes_update on public.cert_lotes
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cert_productos_delete on public.cert_productos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cert_productos_insert on public.cert_productos
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cert_productos_select on public.cert_productos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cert_productos_update on public.cert_productos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cert_recert_insert on public.cert_recertificaciones
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cert_recert_select on public.cert_recertificaciones
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy clients_delete on public.clients
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy clients_insert on public.clients
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy clients_select on public.clients
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy clients_update on public.clients
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy compliance_aceptaciones_select on public.compliance_aceptaciones
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy compliance_cargos_select on public.compliance_cargos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy compliance_liberaciones_select on public.compliance_liberaciones
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy compliance_segmentos_modify on public.compliance_segmentos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy compliance_segmentos_select on public.compliance_segmentos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy config_bono_operaciones_select on public.config_bono_operaciones
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy config_financiera_insert on public.config_financiera
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy config_financiera_select on public.config_financiera
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy config_financiera_update on public.config_financiera
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy config_metas_ws on public.config_metas
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy consultas_listas_dual_ws_isolation on public.consultas_listas_dual
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy contacto_interacciones_rw on public.contacto_interacciones
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy contacts_ws on public.contacts
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy control_causa_delete on public.control_causa
  using ((EXISTS ( SELECT 1
   FROM riesgos_controles rc
  WHERE ((rc.id = control_causa.control_id) AND (rc.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy control_causa_insert on public.control_causa
  with check ((EXISTS ( SELECT 1
   FROM riesgos_controles rc
  WHERE ((rc.id = control_causa.control_id) AND (rc.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy control_causa_select on public.control_causa
  using ((EXISTS ( SELECT 1
   FROM riesgos_controles rc
  WHERE ((rc.id = control_causa.control_id) AND (rc.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy costos_referencia_ws on public.costos_referencia
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cotizaciones_ws on public.cotizaciones
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cs_escalamientos_select on public.cs_escalamientos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cs_escalamientos_update on public.cs_escalamientos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy cuentas_cobro_emitidas_ws on public.cuentas_cobro_emitidas
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy custom_field_mappings_workspace_isolation on public.custom_field_mappings
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy custom_fields_workspace_isolation on public.custom_fields
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy devolucion_eventos_select on public.devolucion_eventos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy drive_health_log_ws on public.drive_health_log
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy empresas_ws on public.empresas
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy entity_labels_workspace_isolation on public.entity_labels
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy etapa_historial_workspace on public.etapa_historial
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy etapa_sla_log_insert_owner_admin on public.etapa_sla_log
  with check (((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.workspace_id = etapa_sla_log.workspace_id) AND (p.role = ANY (ARRAY['owner'::text, 'admin'::text, 'supervisor'::text])))))));

alter policy etapa_sla_log_select_owner_admin_supervisor on public.etapa_sla_log
  using (((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = ( SELECT auth.uid() AS uid)) AND (p.workspace_id = etapa_sla_log.workspace_id) AND (p.role = ANY (ARRAY['owner'::text, 'admin'::text, 'supervisor'::text])))))));

alter policy ec_insert on public.expense_categories
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy ec_select on public.expense_categories
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy ec_update on public.expense_categories
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy exp_delete on public.expenses
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy exp_insert on public.expenses
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy exp_select on public.expenses
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy exp_update on public.expenses
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy fp_insert on public.fiscal_profiles
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy fp_select on public.fiscal_profiles
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy fp_update on public.fiscal_profiles
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy fe_delete on public.fixed_expenses
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy fe_insert on public.fixed_expenses
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy fe_select on public.fixed_expenses
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy fe_update on public.fixed_expenses
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy formulario_versiones_workspace on public.formulario_versiones
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy gastos_fijos_borradores_ws on public.gastos_fijos_borradores
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy gastos_fijos_config_ws on public.gastos_fijos_config
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy grm_delete on public.gastos_recurrentes_map
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy grm_insert on public.gastos_recurrentes_map
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy grm_read on public.gastos_recurrentes_map
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy grm_update on public.gastos_recurrentes_map
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy hs_insert on public.health_scores
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy hs_select on public.health_scores
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy inv_delete on public.invoices
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy inv_insert on public.invoices
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy inv_select on public.invoices
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy inv_update on public.invoices
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy items_via_cotizacion on public.items
  using ((EXISTS ( SELECT 1
   FROM cotizaciones c
  WHERE ((c.id = items.cotizacion_id) AND (c.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy kyc_ref_select on public.kyc_expediente_ref
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy labels_workspace_isolation on public.labels
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy metas_comerciales_delete on public.metas_comerciales
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy metas_comerciales_insert on public.metas_comerciales
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy metas_comerciales_select on public.metas_comerciales
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy metas_comerciales_update on public.metas_comerciales
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy metas_vendedor_select on public.metas_vendedor
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy mt_ws on public.monthly_targets
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy negocio_conciliacion_insert on public.negocio_conciliacion
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy negocio_conciliacion_select on public.negocio_conciliacion
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy negocio_conciliacion_update on public.negocio_conciliacion
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy notes_ws on public.notes
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy notif_insert on public.notifications
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy notif_select on public.notifications
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy notif_update on public.notifications
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy oportunidad_notas_ws on public.oportunidad_notas
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy oportunidades_ws on public.oportunidades
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy opp_delete on public.opportunities
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy opp_insert on public.opportunities
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy opp_select on public.opportunities
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy opp_update on public.opportunities
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy osh_insert on public.opportunity_stage_history
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy osh_select on public.opportunity_stage_history
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy pay_insert on public.payments
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy pay_select on public.payments
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy pay_update on public.payments
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy plan_cobro_cuotas_ws_isolation on public.plan_cobro_cuotas
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy planes_cobro_ws on public.planes_cobro
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy planillas_pila_periodo_ws on public.planillas_pila_periodo
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy proceso_snapshots_select on public.proceso_snapshots
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy proj_delete on public.projects
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy proj_insert on public.projects
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy proj_select on public.projects
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy proj_update on public.projects
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy promoters_ws on public.promoters
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy proyecto_notas_ws on public.proyecto_notas
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy proyecto_rubros_via_proyecto on public.proyecto_rubros
  using ((EXISTS ( SELECT 1
   FROM proyectos p
  WHERE ((p.id = proyecto_rubros.proyecto_id) AND (p.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy proyectos_ws on public.proyectos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy qi_delete on public.quote_items
  using ((EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_items.quote_id) AND (q.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy qi_insert on public.quote_items
  with check ((EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_items.quote_id) AND (q.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy qi_select on public.quote_items
  using ((EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_items.quote_id) AND (q.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy qi_update on public.quote_items
  using ((EXISTS ( SELECT 1
   FROM quotes q
  WHERE ((q.id = quote_items.quote_id) AND (q.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy q_delete on public.quotes
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy q_insert on public.quotes
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy q_select on public.quotes
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy q_update on public.quotes
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy ref_insert on public.referrals
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy ref_select on public.referrals
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy reproceso_eventos_select on public.reproceso_eventos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy riesgo_causas_delete on public.riesgo_causas
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy riesgo_causas_insert on public.riesgo_causas
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy riesgo_causas_select on public.riesgo_causas
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy riesgo_causas_update on public.riesgo_causas
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy riesgos_delete on public.riesgos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy riesgos_insert on public.riesgos
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy riesgos_select on public.riesgos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy riesgos_update on public.riesgos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy rc_delete on public.riesgos_controles
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy rc_insert on public.riesgos_controles
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy rc_select on public.riesgos_controles
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy rc_update on public.riesgos_controles
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy rubros_via_item on public.rubros
  using ((EXISTS ( SELECT 1
   FROM (items i
     JOIN cotizaciones c ON ((c.id = i.cotizacion_id)))
  WHERE ((i.id = rubros.item_id) AND (c.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy saldos_banco_ws on public.saldos_banco
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy servicios_ws on public.servicios
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy staff_areas_delete on public.staff_areas
  using ((EXISTS ( SELECT 1
   FROM staff s
  WHERE ((s.id = staff_areas.staff_id) AND (s.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy staff_areas_insert on public.staff_areas
  with check ((EXISTS ( SELECT 1
   FROM staff s
  WHERE ((s.id = staff_areas.staff_id) AND (s.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy staff_areas_select on public.staff_areas
  using ((EXISTS ( SELECT 1
   FROM staff s
  WHERE ((s.id = staff_areas.staff_id) AND (s.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy staff_areas_update on public.staff_areas
  using ((EXISTS ( SELECT 1
   FROM staff s
  WHERE ((s.id = staff_areas.staff_id) AND (s.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))))
  with check ((EXISTS ( SELECT 1
   FROM staff s
  WHERE ((s.id = staff_areas.staff_id) AND (s.workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id))))));

alter policy stage_transition_rules_isolation on public.stage_transition_rules
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy streaks_ws on public.streaks
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy sub_insert on public.subscriptions
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy sub_select on public.subscriptions
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy admin_write on public.tenant_rules
  using (((tenant_id = ((( SELECT auth.jwt() AS jwt) ->> 'tenant_id'::text))::uuid) AND ( SELECT is_admin_or_owner() AS is_admin_or_owner)));

alter policy tenant_read on public.tenant_rules
  using ((tenant_id = ((( SELECT auth.jwt() AS jwt) ->> 'tenant_id'::text))::uuid));

alter policy test_insert on public.testimonials
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy test_select on public.testimonials
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy test_update on public.testimonials
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy te_delete on public.time_entries
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy te_insert on public.time_entries
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy te_select on public.time_entries
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy te_update on public.time_entries
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy timer_activo_ws on public.timer_activo
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy tutorial_progress_delete on public.tutorial_progress
  using (((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)) AND (user_id = ( SELECT auth.uid() AS uid))));

alter policy tutorial_progress_insert on public.tutorial_progress
  with check (((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)) AND (user_id = ( SELECT auth.uid() AS uid))));

alter policy tutorial_progress_select on public.tutorial_progress
  using (((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)) AND (user_id = ( SELECT auth.uid() AS uid))));

alter policy tutorial_progress_update on public.tutorial_progress
  using (((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)) AND (user_id = ( SELECT auth.uid() AS uid))));

alter policy valida_consultas_insert on public.valida_consultas
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy valida_consultas_select on public.valida_consultas
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy valida_consultas_update on public.valida_consultas
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy datos_sarlaft_workspace on public.valida_sarlaft_datos_negocio
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy score_negocio_workspace on public.valida_score_negocio
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy valida_segmentacion_bitacora_insert on public.valida_segmentacion_bitacora
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy valida_segmentacion_bitacora_select on public.valida_segmentacion_bitacora
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy ciiu_override_workspace on public.valida_segmentacion_ciiu_override
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy valida_segmentacion_config_modify on public.valida_segmentacion_config
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy valida_segmentacion_config_select on public.valida_segmentacion_config
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy ve_log_select_workspace on public.ve_procesamiento_log
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy ventas_hechos_select on public.ventas_hechos
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy wac_delete on public.wa_collaborators
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy wac_insert on public.wa_collaborators
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy wac_select on public.wa_collaborators
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy wac_update on public.wa_collaborators
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy wsdr_read on public.workspace_default_responsables
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy wsdr_write on public.workspace_default_responsables
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)))
  with check ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy workspace_features_workspace_isolation on public.workspace_features
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));

alter policy workspace_stages_isolation on public.workspace_stages
  using ((workspace_id = ( SELECT current_user_workspace_id() AS current_user_workspace_id)));
