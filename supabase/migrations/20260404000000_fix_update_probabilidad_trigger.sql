-- Fix: update_probabilidad trigger preserva valor actual para etapas custom
-- El CASE sin ELSE retornaba NULL para etapas no hardcodeadas (ej: contactado,
-- pago_anticipo, recoleccion_docs), violando el constraint NOT NULL de probabilidad.

CREATE OR REPLACE FUNCTION update_probabilidad()
RETURNS TRIGGER AS $$
BEGIN
  NEW.probabilidad := CASE NEW.etapa
    WHEN 'lead_nuevo'        THEN 10
    WHEN 'contacto_inicial'  THEN 20
    WHEN 'contactado'        THEN 20
    WHEN 'discovery_hecha'   THEN 40
    WHEN 'propuesta_enviada' THEN 60
    WHEN 'negociacion'       THEN 80
    WHEN 'pago_anticipo'     THEN 80
    WHEN 'recoleccion_docs'  THEN 90
    WHEN 'ganada'            THEN 100
    WHEN 'perdida'           THEN 0
    ELSE OLD.probabilidad  -- etapas custom no mapeadas: preservar valor actual
  END;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
