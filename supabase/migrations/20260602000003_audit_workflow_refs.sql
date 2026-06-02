-- ============================================================================
-- audit_workflow_refs(linea_id): valida TODAS las referencias por orden de etapa
-- de una línea contra la realidad (qué etapa provee cada campo / qué bloque vive
-- en qué etapa). Diseñada para correrse DESPUÉS de cualquier reordenamiento de
-- etapas (reorg), que es lo que deja referencias stale.
--
-- Cubre 7 clases de referencia:
--   - readonly        (config_extra.source_etapa_orden — herencia)
--   - condition       (config_extra.condition.source_etapa_orden)
--   - auto_fill       (config_extra.fields[].auto_fill.source_etapa_orden)
--   - doc_link        (config_extra.fields[].doc_link.source_etapa_orden)
--   - cross_check     (config_extra.cross_check.checks[].source_etapa_orden)
--   - campos_fuente   (config_extra.campos_fuente[].source.etapa_orden + bloque_orden)
--   - routing         (etapas_negocio.config_extra.routing — source_etapa_orden / conditional)
--
-- Devuelve una fila por referencia con ok=false cuando el destino NO provee el
-- campo / no contiene el bloque, y `donde_vive` indicando dónde está realmente.
-- Si todo está sano, todas las filas tienen ok=true.
-- ============================================================================

CREATE OR REPLACE FUNCTION audit_workflow_refs(p_linea_id uuid)
RETURNS TABLE (
  clase text,
  host_etapa int,
  host_nombre text,
  tgt_etapa int,
  tgt_bloque int,
  tgt_campo text,
  ok boolean,
  donde_vive text
) LANGUAGE sql STABLE SET search_path = public AS $$
WITH base AS (
  SELECT bc.id, e.orden AS host_etapa, bc.orden AS host_bloque,
         COALESCE(NULLIF(bc.nombre,''), bd.nombre) AS host_nombre, bd.tipo AS host_tipo,
         bc.config_extra AS ce
  FROM bloque_configs bc
  JOIN etapas_negocio e ON e.id = bc.etapa_id
  JOIN bloque_definitions bd ON bd.id = bc.bloque_definition_id
  WHERE e.linea_id = p_linea_id
),
-- Campos provistos por cada bloque ORIGEN (no heredado), por etapa y bloque
disp AS (
  SELECT e.orden AS etapa_orden, bc.orden AS bloque_orden, s.slug
  FROM bloque_configs bc
  JOIN etapas_negocio e ON e.id = bc.etapa_id
  CROSS JOIN LATERAL (
    SELECT c->>'slug' AS slug FROM jsonb_array_elements(COALESCE(bc.config_extra->'campos_extraccion','[]')) c
    UNION ALL
    SELECT f->>'slug' FROM jsonb_array_elements(COALESCE(bc.config_extra->'fields','[]')) f
  ) s
  WHERE e.linea_id = p_linea_id AND COALESCE(bc.config_extra->>'source_etapa_orden','') = ''
),
-- Bloques ORIGEN por etapa (para validar refs que apuntan a un bloque por nombre)
origen AS (
  SELECT e.orden AS etapa_orden, lower(trim(COALESCE(NULLIF(bc.nombre,''), bd.nombre))) AS nombre_norm
  FROM bloque_configs bc
  JOIN etapas_negocio e ON e.id = bc.etapa_id
  JOIN bloque_definitions bd ON bd.id = bc.bloque_definition_id
  WHERE e.linea_id = p_linea_id AND COALESCE(bc.config_extra->>'source_etapa_orden','') = ''
),
refs AS (
  SELECT 'condition' AS clase, host_etapa, host_nombre, (ce->'condition'->>'source_etapa_orden')::int AS tgt_etapa, NULL::int AS tgt_bloque, (ce->'condition'->>'field') AS tgt_campo, 'field' AS modo
  FROM base WHERE ce->'condition' ? 'source_etapa_orden'
  UNION ALL
  SELECT 'auto_fill', host_etapa, host_nombre, (f->'auto_fill'->>'source_etapa_orden')::int, NULL, (f->'auto_fill'->>'field'), 'field'
  FROM base, jsonb_array_elements(COALESCE(ce->'fields','[]')) f WHERE f->'auto_fill' ? 'source_etapa_orden'
  UNION ALL
  SELECT 'cross_check', host_etapa, host_nombre, (chk->>'source_etapa_orden')::int, NULL, COALESCE(chk->>'source_field', chk->'source_fields'->>0), 'field'
  FROM base, jsonb_array_elements(COALESCE(ce->'cross_check'->'checks','[]')) chk WHERE chk ? 'source_etapa_orden'
  UNION ALL
  SELECT 'campos_fuente', host_etapa, host_nombre, (cf->'source'->>'etapa_orden')::int, (cf->'source'->>'bloque_orden')::int, (cf->'source'->>'campo_slug'), 'field_bloque'
  FROM base, jsonb_array_elements(COALESCE(ce->'campos_fuente','[]')) cf WHERE cf->'source' ? 'etapa_orden'
  UNION ALL
  SELECT 'doc_link', host_etapa, host_nombre, (f->'doc_link'->>'source_etapa_orden')::int, NULL, lower(trim(f->'doc_link'->>'source_bloque_nombre')), 'bloque'
  FROM base, jsonb_array_elements(COALESCE(ce->'fields','[]')) f WHERE f->'doc_link' ? 'source_etapa_orden'
  UNION ALL
  SELECT 'readonly', host_etapa, host_nombre, (ce->>'source_etapa_orden')::int, NULL, lower(trim(COALESCE(NULLIF(host_nombre,''),''))), 'bloque'
  FROM base WHERE ce ? 'source_etapa_orden'
  UNION ALL
  -- routing en etapas_negocio: conditional[].condition.field leído de source_etapa_orden (o de la propia etapa)
  SELECT 'routing', e.orden, e.nombre, COALESCE((e.config_extra->'routing'->>'source_etapa_orden')::int, e.orden), NULL, (cond->'condition'->>'field'), 'field'
  FROM etapas_negocio e, jsonb_array_elements(COALESCE(e.config_extra->'routing'->'conditional','[]')) cond
  WHERE e.linea_id = p_linea_id
)
SELECT r.clase, r.host_etapa, r.host_nombre, r.tgt_etapa, r.tgt_bloque, r.tgt_campo,
  CASE r.modo
    WHEN 'field'        THEN EXISTS (SELECT 1 FROM disp d WHERE d.etapa_orden = r.tgt_etapa AND d.slug = r.tgt_campo)
    WHEN 'field_bloque' THEN EXISTS (SELECT 1 FROM disp d WHERE d.etapa_orden = r.tgt_etapa AND d.bloque_orden = r.tgt_bloque AND d.slug = r.tgt_campo)
    WHEN 'bloque'       THEN EXISTS (SELECT 1 FROM origen o WHERE o.etapa_orden = r.tgt_etapa AND o.nombre_norm = r.tgt_campo)
    ELSE true END AS ok,
  CASE r.modo
    WHEN 'field'        THEN (SELECT string_agg(DISTINCT d.etapa_orden::text, ',' ORDER BY d.etapa_orden::text) FROM disp d WHERE d.slug = r.tgt_campo)
    WHEN 'field_bloque' THEN (SELECT string_agg(DISTINCT d.etapa_orden::text||'/'||d.bloque_orden::text, ',') FROM disp d WHERE d.slug = r.tgt_campo)
    WHEN 'bloque'       THEN (SELECT string_agg(DISTINCT o.etapa_orden::text, ',' ORDER BY o.etapa_orden::text) FROM origen o WHERE o.nombre_norm = r.tgt_campo)
    ELSE NULL END AS donde_vive
FROM refs r
ORDER BY ok, r.clase, r.host_etapa;
$$;

COMMENT ON FUNCTION audit_workflow_refs(uuid) IS
  'Valida todas las referencias por orden de etapa de una línea contra la realidad. Correr tras cualquier reorg de etapas. ok=false = referencia stale; donde_vive indica el orden correcto.';
