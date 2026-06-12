-- ════════════════════════════════════════════════════════════════════════════
-- condicion_cumplida: resolver el bloque fuente de una condición por SLUG estable
-- (vía preferida) antes del fallback legacy por (linea, source_etapa_orden).
-- Spec: docs/specs/2026-05-26_block-references-by-slug.md
-- ════════════════════════════════════════════════════════════════════════════
--
-- Mantiene PARIDAD con el render cliente (negocio-detail-client.tsx), que también
-- prioriza condition.source_bloque_slug sobre source_etapa_orden. El branch slug
-- aplana campos AI — coalesce(data->>field, data->'campos'->field->>'value') —
-- igual que el bag que consume el cliente. Sin slug, comportamiento idéntico al
-- anterior (fallback por orden de etapa).
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.condicion_cumplida(p_negocio_id uuid, p_linea_id uuid, p_etapa_actual_id uuid, p_cond jsonb)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
DECLARE
  v_field        TEXT := p_cond->>'field';
  v_slug         TEXT := p_cond->>'source_bloque_slug';
  v_source_etapa UUID;
  v_raw          TEXT;
BEGIN
  IF v_field IS NULL THEN
    RETURN TRUE;
  END IF;

  IF v_slug IS NOT NULL THEN
    -- Vía preferida: bloque identificado por slug estable dentro de la línea.
    SELECT COALESCE(nb.data->>v_field, nb.data->'campos'->v_field->>'value')
      INTO v_raw
    FROM negocio_bloques nb
    JOIN bloque_configs bc ON bc.id = nb.bloque_config_id
    JOIN etapas_negocio e ON e.id = bc.etapa_id
    WHERE nb.negocio_id = p_negocio_id
      AND e.linea_id = p_linea_id
      AND bc.slug = v_slug
    LIMIT 1;
  ELSE
    -- Fallback legacy: por (linea, source_etapa_orden) o etapa actual.
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

    SELECT nb.data->>v_field INTO v_raw
    FROM negocio_bloques nb
    JOIN bloque_configs bc ON bc.id = nb.bloque_config_id
    WHERE nb.negocio_id = p_negocio_id
      AND bc.etapa_id = v_source_etapa
      AND nb.data ? v_field
    LIMIT 1;
  END IF;

  v_raw := COALESCE(v_raw, '');

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
$function$;
