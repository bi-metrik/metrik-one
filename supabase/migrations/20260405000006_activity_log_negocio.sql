-- ============================================================
-- Fix: activity_log.entidad_tipo → agregar 'negocio'
-- El CHECK constraint original solo permite 'oportunidad','proyecto'
-- Los negocios (sistema Clarity) necesitan su propio timeline
-- ============================================================

-- DROP + ADD CONSTRAINT (ALTER TABLE CONSTRAINT no soporta modificacion directa en PG)
ALTER TABLE activity_log
  DROP CONSTRAINT IF EXISTS activity_log_entidad_tipo_check;

ALTER TABLE activity_log
  ADD CONSTRAINT activity_log_entidad_tipo_check
  CHECK (entidad_tipo IN ('oportunidad', 'proyecto', 'negocio'));
