-- epoca: no-rompe solo borra tablas backup_* que ninguna pantalla, vista ni funcion lee
-- Borra 47 tablas public.backup_* con mas de 30 dias al 2026-10-05 (creadas 2026-08-10 a 2026-09-03).
-- Decision de Mauricio 2026-10-05 (proyectos/metrik/valida/docs/crecimiento-mrr/10-decisiones-mauricio.md,
-- "Revision de tablas backup"): copias de datos personales sin vencimiento (habeas data, temporalidad).
-- Verificado por SELECT el 2026-10-05: ninguna vista, funcion, FK ni trigger las referencia; src/ solo las
-- menciona en comentarios y en src/types/database.ts (tipos generados, retirados aqui).
-- NO se tocan 3 tablas con comentario explicito "NO BORRAR" (pendientes de decision de Mauricio):
--   backup_negocio_responsables_20260810, backup_seccional_negocios_20260810,
--   backup_bloque_configs_notificacion_20260810.
-- Las de septiembre en adelante vencen en su fecha (ver CLAUDE.md, "Backups").
-- IRREVERSIBLE: no hay vuelta atras salvo PITR.

-- Dry-run: corre este bloque solo para ver lo que borraria (no borra nada).
DO $dry$
DECLARE
  v_lista text[] := ARRAY[
    'backup_areas_editoras_fecha_cita_20260810',
    'backup_bloque_cita_dian_requerida_20260818',
    'backup_bloque_configs_a1_20260831',
    'backup_bloque_configs_tipo_doc_20260825',
    'backup_bloque_fecha_cita_notif_20260810',
    'backup_bloque_revision_radicado_20260818',
    'backup_cobro_duplicado_ref378962162_20260811',
    'backup_contactos_form4106_20260902',
    'backup_contactos_telefono_20260902',
    'backup_etapa_documentacion_routing_20260811',
    'backup_etapa_documentacion_routing_20260818',
    'backup_etapa_precobro_20260902',
    'backup_etapa_v0012_v0246_20260818',
    'backup_etapa_v0115_v0138_20260818',
    'backup_etapas_aviso_cliente_wa_20260824',
    'backup_etapas_revision_radicado_20260812',
    'backup_factura_campos_extraccion_20260903',
    'backup_fase2_notificacion_20260810',
    'backup_formulario_tipo_doc_20260825',
    'backup_gate_anticipo_20260826',
    'backup_guias_etapa_20260813',
    'backup_marcas_factura_20260810',
    'backup_marcas_siigo_cliente_20260902',
    'backup_meta_leads_config_20260902',
    'backup_negocio_bloques_aprobado_servicio_20260901',
    'backup_negocio_bloques_servicio_20260818',
    'backup_negocio_etapa_20260818',
    'backup_negocio_responsables_20260902',
    'backup_negocio_responsables_deisy_20260902',
    'backup_nombres_negocio_n_20260902',
    'backup_precio_aprobado_20260810',
    'backup_propuesta_plan_historico_20260826',
    'backup_prueba_20260902_contactos',
    'backup_prueba_20260902_empresa_giraldo',
    'backup_prueba_20260902_empresas',
    'backup_prueba_20260902_negocios',
    'backup_recibo_caja_config_20260903',
    'backup_reclasificacion_pasante_20260818',
    'backup_rediseno_rama_iva_20260810',
    'backup_rls_policies_20260831',
    'backup_rut_campos_extraccion_20260825',
    'backup_rut_campos_ubicacion_20260825',
    'backup_staff_areas_20260902',
    'backup_telefono_no_numerico_20260902',
    'backup_v0122_correccion_ruta_20260810',
    'backup_v0122_negocio_20260810',
    'backup_workspace_modules_20260903'

  ];
  t text; v_existen int := 0; v_filas bigint := 0; v_n bigint;
BEGIN
  FOREACH t IN ARRAY v_lista LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('select count(*) from public.%I', t) INTO v_n;
      v_existen := v_existen + 1; v_filas := v_filas + v_n;
    END IF;
  END LOOP;
  RAISE NOTICE 'DRY-RUN: borraria % tablas de % listadas, % filas en total', v_existen, array_length(v_lista,1), v_filas;
END
$dry$;

DROP TABLE IF EXISTS public.backup_areas_editoras_fecha_cita_20260810;
DROP TABLE IF EXISTS public.backup_bloque_cita_dian_requerida_20260818;
DROP TABLE IF EXISTS public.backup_bloque_configs_a1_20260831;
DROP TABLE IF EXISTS public.backup_bloque_configs_tipo_doc_20260825;
DROP TABLE IF EXISTS public.backup_bloque_fecha_cita_notif_20260810;
DROP TABLE IF EXISTS public.backup_bloque_revision_radicado_20260818;
DROP TABLE IF EXISTS public.backup_cobro_duplicado_ref378962162_20260811;
DROP TABLE IF EXISTS public.backup_contactos_form4106_20260902;
DROP TABLE IF EXISTS public.backup_contactos_telefono_20260902;
DROP TABLE IF EXISTS public.backup_etapa_documentacion_routing_20260811;
DROP TABLE IF EXISTS public.backup_etapa_documentacion_routing_20260818;
DROP TABLE IF EXISTS public.backup_etapa_precobro_20260902;
DROP TABLE IF EXISTS public.backup_etapa_v0012_v0246_20260818;
DROP TABLE IF EXISTS public.backup_etapa_v0115_v0138_20260818;
DROP TABLE IF EXISTS public.backup_etapas_aviso_cliente_wa_20260824;
DROP TABLE IF EXISTS public.backup_etapas_revision_radicado_20260812;
DROP TABLE IF EXISTS public.backup_factura_campos_extraccion_20260903;
DROP TABLE IF EXISTS public.backup_fase2_notificacion_20260810;
DROP TABLE IF EXISTS public.backup_formulario_tipo_doc_20260825;
DROP TABLE IF EXISTS public.backup_gate_anticipo_20260826;
DROP TABLE IF EXISTS public.backup_guias_etapa_20260813;
DROP TABLE IF EXISTS public.backup_marcas_factura_20260810;
DROP TABLE IF EXISTS public.backup_marcas_siigo_cliente_20260902;
DROP TABLE IF EXISTS public.backup_meta_leads_config_20260902;
DROP TABLE IF EXISTS public.backup_negocio_bloques_aprobado_servicio_20260901;
DROP TABLE IF EXISTS public.backup_negocio_bloques_servicio_20260818;
DROP TABLE IF EXISTS public.backup_negocio_etapa_20260818;
DROP TABLE IF EXISTS public.backup_negocio_responsables_20260902;
DROP TABLE IF EXISTS public.backup_negocio_responsables_deisy_20260902;
DROP TABLE IF EXISTS public.backup_nombres_negocio_n_20260902;
DROP TABLE IF EXISTS public.backup_precio_aprobado_20260810;
DROP TABLE IF EXISTS public.backup_propuesta_plan_historico_20260826;
DROP TABLE IF EXISTS public.backup_prueba_20260902_contactos;
DROP TABLE IF EXISTS public.backup_prueba_20260902_empresa_giraldo;
DROP TABLE IF EXISTS public.backup_prueba_20260902_empresas;
DROP TABLE IF EXISTS public.backup_prueba_20260902_negocios;
DROP TABLE IF EXISTS public.backup_recibo_caja_config_20260903;
DROP TABLE IF EXISTS public.backup_reclasificacion_pasante_20260818;
DROP TABLE IF EXISTS public.backup_rediseno_rama_iva_20260810;
DROP TABLE IF EXISTS public.backup_rls_policies_20260831;
DROP TABLE IF EXISTS public.backup_rut_campos_extraccion_20260825;
DROP TABLE IF EXISTS public.backup_rut_campos_ubicacion_20260825;
DROP TABLE IF EXISTS public.backup_staff_areas_20260902;
DROP TABLE IF EXISTS public.backup_telefono_no_numerico_20260902;
DROP TABLE IF EXISTS public.backup_v0122_correccion_ruta_20260810;
DROP TABLE IF EXISTS public.backup_v0122_negocio_20260810;
DROP TABLE IF EXISTS public.backup_workspace_modules_20260903;
