-- Alarma de hallazgo del oficial de cumplimiento (P1, diagnóstico Noor + Lucía
-- 2026-10-20, aprobado por Mauricio).
--
-- Hasta hoy solo el barrido de monitoreo avisaba (`compliance_delta_contraparte`).
-- Una consulta manual o masiva con hallazgo no le llegaba a nadie. El tipo nuevo
-- es el aviso de esas consultas. Se cierra decidiendo (grupo_clave
-- `compliance_hallazgo:<contraparte>`), no leyendo; eso lo hace la aplicación con
-- `resolver_grupo_notificaciones`, que ya existe.
--
-- Solo cambia el CHECK de tipos: no toca filas. La lista es la vigente en
-- producción al 2026-10-20 (leída de pg_constraint) más el tipo nuevo.

alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (
  tipo = any (array[
    'inactividad_oportunidad', 'handoff', 'asignacion_responsable',
    'asignacion_colaborador', 'mencion', 'streak_roto', 'inactividad_proyecto',
    'proyecto_entregado', 'proyecto_cerrado', 'cobro_vencido', 'cobro_proximo',
    'plan_terminado', 'cuenta_cobro_pendiente_aprobacion', 'cuenta_cobro_enviada',
    'cuenta_cobro_envio_fallo', 'responsable_faltante_area',
    'negocio_cancelado', 'negocio_reabierto', 'negocio_reactivado',
    'conciliacion_solicitada', 'mencion_equipo', 'reproceso', 'negocio_en_etapa',
    'precio_corregido', 'devolucion_bloque', 'compliance_delta_contraparte',
    'ferreteria_pago', 'pago_proveedor_por_vencer', 'pago_proveedor_vencido',
    'cuota_por_vencer', 'aprobacion_pendiente', 'aprobacion_decidida',
    'toque_seguimiento', 'viaje_sin_listo',
    'compliance_hallazgo'  -- consulta con hallazgo -> lo ve el oficial hasta que decide
  ])
);
