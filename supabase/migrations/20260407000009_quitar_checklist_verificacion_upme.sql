-- ============================================================
-- Quitar el checklist viejo de verificación UPME de etapa 3
-- (el que tenía condition field=verificacion_upme con items
-- "Verificar estado en UPME" y "Confirmar documentos completos")
-- ============================================================

DELETE FROM bloque_configs
WHERE etapa_id = (
  SELECT en.id FROM etapas_negocio en
  JOIN lineas_negocio ln ON ln.id = en.linea_id
  WHERE ln.tipo = 'clarity' AND ln.nombre ILIKE '%VE%' AND en.orden = 3
  LIMIT 1
)
AND bloque_definition_id = (SELECT id FROM bloque_definitions WHERE tipo = 'checklist' LIMIT 1)
AND config_extra->'items' @> '[{"label":"Verificar estado en UPME"}]'::jsonb;
