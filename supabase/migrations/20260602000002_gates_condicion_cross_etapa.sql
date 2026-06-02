-- ============================================================================
-- Gate condition: honrar source_etapa_orden + value_in (paridad con el render)
--
-- Problema: gates_pendientes_etapa / puede_avanzar_etapa evaluaban la condición
-- de un gate buscando el campo SOLO en la etapa actual. El render del bloque
-- (negocio-detail-client.tsx) lee el campo desde la etapa indicada por
-- condition.source_etapa_orden y soporta value_in. Resultado: un gate condicional
-- cross-etapa (ej. "Certificado bancario" condicionado a requiere_devolucion_iva,
-- toggle que vive en Negociación) BLOQUEA el avance pero el bloque NO se renderiza
-- → negocio atascado sin forma de completar el gate.
--
-- Fix: helper condicion_cumplida() que replica exactamente la lógica del render:
--   - source_etapa_orden → lee el campo de esa etapa (misma línea); si no, etapa actual
--   - value_in (lista) → membresía normalizada (lower + unaccent + trim), como el render
--   - value (escalar) → igualdad exacta, como el render
-- gates_pendientes_etapa pasa a usar este helper. puede_avanzar_etapa ya lo reusa.
-- ============================================================================

CREATE OR REPLACE FUNCTION condicion_cumplida(
  p_negocio_id      UUID,
  p_linea_id        UUID,
  p_etapa_actual_id UUID,
  p_cond            JSONB
) RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_field        TEXT := p_cond->>'field';
  v_source_etapa UUID;
  v_raw          TEXT;
BEGIN
  -- Sin field declarado → no restringe
  IF v_field IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Resolver etapa fuente: cross-etapa (source_etapa_orden) o etapa actual
  IF (p_cond->>'source_etapa_orden') IS NOT NULL THEN
    SELECT id INTO v_source_etapa
    FROM etapas_negocio
    WHERE linea_id = p_linea_id
      AND orden = (p_cond->>'source_etapa_orden')::int;
  ELSE
    v_source_etapa := p_etapa_actual_id;
  END IF;

  IF v_source_etapa IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Valor del campo desde cualquier bloque de la etapa fuente que lo tenga
  SELECT nb.data->>v_field INTO v_raw
  FROM negocio_bloques nb
  JOIN bloque_configs bc ON bc.id = nb.bloque_config_id
  WHERE nb.negocio_id = p_negocio_id
    AND bc.etapa_id = v_source_etapa
    AND nb.data ? v_field
  LIMIT 1;

  v_raw := COALESCE(v_raw, '');

  -- value_in (lista, normalizado como el render) vs value (escalar, exacto)
  IF p_cond ? 'value_in' THEN
    RETURN EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(p_cond->'value_in') AS opt
      WHERE unaccent(lower(trim(opt))) = unaccent(lower(trim(v_raw)))
    );
  ELSE
    RETURN v_raw = (p_cond->>'value');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION gates_pendientes_etapa(
  p_negocio_id UUID,
  p_etapa_id   UUID
) RETURNS TABLE (
  bloque_config_id UUID,
  nombre TEXT,
  tipo TEXT,
  orden INTEGER
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_linea_id UUID;
BEGIN
  SELECT linea_id INTO v_linea_id FROM etapas_negocio WHERE id = p_etapa_id;

  RETURN QUERY
  SELECT
    bc.id,
    COALESCE(NULLIF(bc.config_extra->>'label', ''), bd.nombre) AS nombre,
    bd.tipo,
    bc.orden
  FROM bloque_configs bc
  JOIN negocio_bloques nb ON nb.bloque_config_id = bc.id
                         AND nb.negocio_id = p_negocio_id
  JOIN bloque_definitions bd ON bd.id = bc.bloque_definition_id
  WHERE bc.etapa_id = p_etapa_id
    AND bc.es_gate = true
    AND nb.estado = 'pendiente'
    AND (
      bc.config_extra->'condition' IS NULL
      OR condicion_cumplida(p_negocio_id, v_linea_id, p_etapa_id, bc.config_extra->'condition')
    )
  ORDER BY bc.orden;
END;
$$;
