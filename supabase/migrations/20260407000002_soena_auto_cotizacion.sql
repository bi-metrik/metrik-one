-- ============================================================
-- SOENA: Auto-cotización en etapa 1
-- 1. Bloque cotización → editable + es_gate
-- 2. config_extra con auto_cotizacion para crearNegocio()
-- ============================================================

UPDATE bloque_configs
SET
  estado = 'editable',
  es_gate = true,
  config_extra = jsonb_build_object(
    'auto_cotizacion', jsonb_build_object(
      'servicio_nombre', 'Radicación de proyecto VE en UPME',
      'usar_precio_estimado', true
    )
  )
FROM etapas_negocio en
JOIN lineas_negocio ln ON ln.id = en.linea_id,
     bloque_definitions bd
WHERE bloque_configs.etapa_id = en.id
  AND bloque_configs.bloque_definition_id = bd.id
  AND en.orden = 1
  AND ln.tipo = 'clarity'
  AND ln.nombre ILIKE '%VE%'
  AND bd.tipo = 'cotizacion';
