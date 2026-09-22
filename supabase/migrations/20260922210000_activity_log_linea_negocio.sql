-- Los cambios de margen mínimo, aviso y recargo de una línea quedan en activity_log con
-- entidad_tipo = 'linea_negocio' (PR #820). Solo ENSANCHA el CHECK: ninguna fila existente
-- deja de cumplirlo y no se toca ningún dato.
--
-- APLICADA el 2026-09-22 por MCP con autorización de Mauricio, antes del merge, y
-- registrada en el ledger con esta misma versión. Fuente y comprobaciones:
-- proyectos/trappvel/clarity/migrations/2026-09-22_activity-log-linea-negocio-PENDIENTE.sql
alter table activity_log drop constraint if exists activity_log_entidad_tipo_check;

alter table activity_log add constraint activity_log_entidad_tipo_check
  check (entidad_tipo = any (array['oportunidad'::text, 'proyecto'::text, 'negocio'::text, 'contacto'::text, 'linea_negocio'::text]));
