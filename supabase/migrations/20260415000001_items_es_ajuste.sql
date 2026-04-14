-- Items: campo es_ajuste para item de reconciliacion automatica
ALTER TABLE items ADD COLUMN IF NOT EXISTS es_ajuste BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN items.es_ajuste IS 'true para el item de ajuste automático. Gestionado por el sistema.';
