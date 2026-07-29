-- Tipo de notificación `precio_corregido` (genérico ONE)
--
-- Lo emite `corregirValorAprobado` para avisarle al comercial responsable que el
-- valor aprobado de SU negocio cambió y no fue él quien lo cambió.
--
-- Por qué una migración y no reusar un tipo existente: `notificaciones.tipo` tiene
-- un CHECK cerrado y un tipo ausente hace fallar el INSERT **en silencio** dentro
-- de la RPC. Ese patrón ya costó tres incidentes en este repo (cancelar/reabrir/
-- reactivar negocio, la migración de S1 sin aplicar y el módulo SARLAFT, donde las
-- alertas del reporte ROS nunca le llegaron a nadie). Ningún tipo nuevo se emite
-- desde el código sin agregarlo aquí primero.

alter table notificaciones drop constraint if exists notificaciones_tipo_check;

alter table notificaciones add constraint notificaciones_tipo_check check (
  tipo = any (array[
    'inactividad_oportunidad',
    'handoff',
    'asignacion_responsable',
    'asignacion_colaborador',
    'mencion',
    'streak_roto',
    'inactividad_proyecto',
    'proyecto_entregado',
    'proyecto_cerrado',
    'cobro_vencido',
    'cobro_proximo',
    'plan_terminado',
    'cuenta_cobro_pendiente_aprobacion',
    'cuenta_cobro_enviada',
    'cuenta_cobro_envio_fallo',
    'responsable_faltante_area',
    'negocio_cancelado',
    'negocio_reabierto',
    'negocio_reactivado',
    'conciliacion_solicitada',
    'mencion_equipo',
    'reproceso',
    'negocio_en_etapa',
    'precio_corregido'
  ])
);
