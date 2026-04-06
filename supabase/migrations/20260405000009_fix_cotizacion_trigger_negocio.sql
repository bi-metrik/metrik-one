-- Fix trigger: para cotizaciones sin oportunidad_id (vinculadas a negocios),
-- el COUNT con '= NULL' siempre es 0 → genera 'SIN-C1' siempre → viola UNIQUE.
-- Fix: si oportunidad_id IS NULL, usar el consecutivo como codigo (ya es único).
CREATE OR REPLACE FUNCTION trg_cotizacion_auto_codigo()
RETURNS TRIGGER AS $$
DECLARE
  v_opp_codigo TEXT;
  v_next_seq INT;
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    IF NEW.oportunidad_id IS NOT NULL THEN
      -- Cotización vinculada a oportunidad (flujo normal)
      SELECT codigo INTO v_opp_codigo
      FROM oportunidades
      WHERE id = NEW.oportunidad_id;

      SELECT COUNT(*) + 1 INTO v_next_seq
      FROM cotizaciones
      WHERE oportunidad_id = NEW.oportunidad_id;

      NEW.codigo := COALESCE(v_opp_codigo, 'SIN') || '-C' || v_next_seq;
    ELSE
      -- Cotización vinculada a negocio (oportunidad_id IS NULL)
      -- Usar consecutivo como codigo: ya es único dentro del workspace
      NEW.codigo := COALESCE(NEW.consecutivo, 'NEG-' || EXTRACT(EPOCH FROM NOW())::bigint::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
