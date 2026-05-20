-- ============================================================
-- FASE 1 — Roles · Areas · Stages: ampliar etapas_negocio.stage
-- ============================================================
-- etapas_negocio.stage ya existe con CHECK ('venta','ejecucion','cobro').
-- Agregamos 'cerrado' como cuarto valor para etapas terminales del flujo.
--
-- Cada etapa del workflow ya pertenece a un stage; este cambio solo
-- amplia el dominio para permitir etapas terminales tipo 'Cerrado',
-- 'Perdido', 'Cancelado' que cierran el ciclo de un negocio.
--
-- NO se hace backfill agresivo de etapas existentes a 'cerrado' aqui — la
-- semantica de stage en etapa ya viene seteada correctamente para los
-- workspaces existentes (venta/ejecucion/cobro). Si en una linea hay
-- una etapa que el equipo entiende como terminal (perder/cancelar), eso
-- se ajusta en Fase 2 con QA workspace por workspace.
-- ============================================================

ALTER TABLE etapas_negocio DROP CONSTRAINT IF EXISTS etapas_negocio_stage_check;
ALTER TABLE etapas_negocio ADD CONSTRAINT etapas_negocio_stage_check
  CHECK (stage IN ('venta', 'ejecucion', 'cobro', 'cerrado'));

COMMENT ON COLUMN etapas_negocio.stage IS
  'Stage al que pertenece esta etapa del workflow: venta | ejecucion | cobro | cerrado. '
  'Modelo roles-areas-stages Fase 1 (2026-05-20).';

-- ============================================================
-- Backfill heuristico para etapas con nombres que sugieren cerrado
-- (conservador — solo nombres muy claros y solo si la etapa es la ultima
-- de su linea, para no mover prematuramente etapas intermedias)
-- ============================================================
WITH ultimas AS (
  SELECT DISTINCT ON (linea_id) id, nombre, linea_id, orden
  FROM etapas_negocio
  ORDER BY linea_id, orden DESC
)
UPDATE etapas_negocio en
SET stage = 'cerrado'
FROM ultimas u
WHERE en.id = u.id
  AND en.stage <> 'cerrado'
  AND (
    LOWER(en.nombre) ~ '\m(cerrado|cerrada|cierre|finalizado|finalizada|completado|completada|entregado|entregada)\M'
    OR LOWER(en.nombre) ~ '\m(perdido|perdida|cancelado|cancelada|archivado|archivada)\M'
  );
