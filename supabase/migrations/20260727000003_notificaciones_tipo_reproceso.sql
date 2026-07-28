-- Agrega 'reproceso' al CHECK de notificaciones.tipo.
--
-- Los reprocesos (devolver un negocio a una etapa anterior porque un tercero
-- rechazo el trabajo) notifican a supervisores, admin y owner. Sin este tipo en el
-- CHECK, ese insert violaria la constraint y el aviso se perderia: exactamente el
-- patron de "avisos que fallaban mudos" que corrigio 20260727000002.
--
-- Se re-declara el array completo porque un CHECK no se puede extender en sitio.

alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;

alter table public.notificaciones add constraint notificaciones_tipo_check check (
  tipo = any (array[
    'inactividad_oportunidad', 'handoff', 'asignacion_responsable',
    'asignacion_colaborador', 'mencion', 'streak_roto', 'inactividad_proyecto',
    'proyecto_entregado', 'proyecto_cerrado', 'cobro_vencido', 'cobro_proximo',
    'plan_terminado', 'cuenta_cobro_pendiente_aprobacion', 'cuenta_cobro_enviada',
    'cuenta_cobro_envio_fallo', 'responsable_faltante_area',
    'negocio_cancelado', 'negocio_reabierto', 'negocio_reactivado',
    -- nuevo: reproceso abierto sobre un negocio vivo (reproceso-actions.ts)
    'reproceso'
  ])
);
