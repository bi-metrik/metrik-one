-- gates_pendientes_etapa: nombrar el gate como se llama en el flujo.
--
-- Problema: la funcion resolvia el nombre como COALESCE(config_extra->>'label',
-- bloque_definitions.nombre). `label` casi nunca esta puesto y el nombre de la
-- DEFINICION es el del tipo generico ("Datos", "Documento"), asi que el modal le
-- decia al operador "falta Datos" sin decir cual. En SOENA los tres gates medidos
-- el 2026-08-03 (Cita DIAN, Via de solicitud de la cita, Confirmacion de entrega)
-- se anunciaban los tres como "Datos".
--
-- `bloque_configs.nombre` es el nombre que el bloque tiene EN ESA ETAPA, que es el
-- que el equipo ve en pantalla. Pasa a ser la primera opcion.
--
-- Orden de precedencia: label (override explicito) > nombre del bloque en la etapa
-- > nombre de la definicion (compatibilidad con configs viejas sin nombre).
--
-- Cambio aditivo: misma firma, mismas columnas, mismas filas. Solo cambia el texto
-- de la columna `nombre`, que ningun consumidor compara por igualdad (se muestra).

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
    COALESCE(
      NULLIF(bc.config_extra->>'label', ''),
      NULLIF(bc.nombre, ''),
      bd.nombre
    ) AS nombre,
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
