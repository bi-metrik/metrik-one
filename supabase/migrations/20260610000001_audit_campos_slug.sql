-- audit_workflow_refs: entender campos_fuente con `campos_slug` (varios campos
-- concatenados, ej. marca + línea/modelo del certificado en la Declaración).
-- Antes solo validaba `source.campo_slug` (singular) → una fuente con campos_slug
-- daba tgt_campo NULL → falso stale. Ahora valida cada slug del array.
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
  FROM base, jsonb_array_elements(COALESCE(ce->'campos_fuente','[]')) cf WHERE cf->'source' ? 'etapa_orden' AND cf->'source' ? 'campo_slug'
  UNION ALL
  -- campos_fuente con varios campos concatenados (source.campos_slug[]): valida cada uno
  SELECT 'campos_fuente', host_etapa, host_nombre, (cf->'source'->>'etapa_orden')::int, (cf->'source'->>'bloque_orden')::int, slug_elem, 'field_bloque'
  FROM base, jsonb_array_elements(COALESCE(ce->'campos_fuente','[]')) cf,
       jsonb_array_elements_text(cf->'source'->'campos_slug') slug_elem
  WHERE cf->'source' ? 'campos_slug'
  UNION ALL
  SELECT 'doc_link', host_etapa, host_nombre, (f->'doc_link'->>'source_etapa_orden')::int, NULL, lower(trim(f->'doc_link'->>'source_bloque_nombre')), 'bloque'
  FROM base, jsonb_array_elements(COALESCE(ce->'fields','[]')) f WHERE f->'doc_link' ? 'source_etapa_orden'
  UNION ALL
  SELECT 'readonly', host_etapa, host_nombre, (ce->>'source_etapa_orden')::int, NULL, lower(trim(COALESCE(NULLIF(host_nombre,''),''))), 'bloque'
  FROM base WHERE ce ? 'source_etapa_orden'
  UNION ALL
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
