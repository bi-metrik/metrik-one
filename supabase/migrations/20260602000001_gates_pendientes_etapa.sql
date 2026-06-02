-- ============================================================================
-- gates_pendientes_etapa: lista los bloques gate que aún BLOQUEAN el avance
-- de etapa (estado 'pendiente' + condición cumplida).
--
-- Motivo: el server listaba TODOS los bloques es_gate de la etapa al bloquear
-- el avance (incluidos los ya completos), divergiendo de la lógica real del
-- gate. Esta función expone exactamente las filas que cuenta puede_avanzar_etapa,
-- y puede_avanzar_etapa se redefine para reusarla → una sola fuente de verdad,
-- cero drift entre el booleano y la lista que se muestra al usuario.
--
-- Devuelve el label real (config_extra.label si existe, si no el nombre de la
-- definición) para que el modal precise qué falta.
-- ============================================================================

CREATE OR REPLACE FUNCTION gates_pendientes_etapa(
  p_negocio_id UUID,
  p_etapa_id   UUID
) RETURNS TABLE (
  bloque_config_id UUID,
  nombre TEXT,
  tipo TEXT,
  orden INTEGER
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    -- Ignorar gates con condición que no se cumple (mismo criterio que el
    -- booleano original)
    AND (
      bc.config_extra->'condition' IS NULL
      OR EXISTS (
        SELECT 1 FROM negocio_bloques nb2
        JOIN bloque_configs bc2 ON bc2.id = nb2.bloque_config_id
        WHERE nb2.negocio_id = p_negocio_id
          AND bc2.etapa_id = p_etapa_id
          AND nb2.data->>((bc.config_extra->'condition'->>'field'))
              = (bc.config_extra->'condition'->>'value')
      )
    )
  ORDER BY bc.orden;
$$;

-- Redefinir puede_avanzar_etapa para que reuse gates_pendientes_etapa.
-- Misma firma y semántica (TRUE = puede avanzar). Pasa de plpgsql a sql.
CREATE OR REPLACE FUNCTION puede_avanzar_etapa(
  p_negocio_id UUID,
  p_etapa_id   UUID
) RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM gates_pendientes_etapa(p_negocio_id, p_etapa_id)
  );
$$;
