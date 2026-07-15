-- gates_pendientes_etapa: excluir bloques desactivados (config_extra.desactivado=true).
-- Bug: al desactivar un bloque gate, el render (getNegocioDetalle) lo ocultaba pero
-- esta función SQL seguía contándolo como gate pendiente → bloqueaba el avance de etapa.
-- Fix: la función ahora ignora los bloques con config_extra.desactivado=true, alineándose
-- con el render y con la intención del flag "desactivado" (sacar el bloque del flujo Y del gate).
-- Aplicada a prod vía MCP el 2026-07-15.
CREATE OR REPLACE FUNCTION public.gates_pendientes_etapa(p_negocio_id uuid, p_etapa_id uuid)
 RETURNS TABLE(bloque_config_id uuid, nombre text, tipo text, orden integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    AND COALESCE((bc.config_extra->>'desactivado')::boolean, false) = false
    AND (
      bc.config_extra->'condition' IS NULL
      OR condicion_cumplida(p_negocio_id, v_linea_id, p_etapa_id, bc.config_extra->'condition')
    )
  ORDER BY bc.orden;
END;
$function$;
