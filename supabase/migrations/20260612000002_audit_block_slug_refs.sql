-- ════════════════════════════════════════════════════════════════════════════
-- Guardián de referencias por SLUG estable (companion de audit_workflow_refs).
-- Spec: docs/specs/2026-05-26_block-references-by-slug.md
-- ════════════════════════════════════════════════════════════════════════════
--
-- audit_workflow_refs(linea_id) valida las referencias por ORDEN/NOMBRE (capa legacy).
-- Esta función valida la nueva capa de identidad estable (slug):
--   1. ningún slug se repite dentro de una misma línea (identidad única)
--   2. todo slug referenciado (cross_check + alternativas, auto_fill, campos_fuente +
--      alternativas, doc_link) existe como bloque real de la línea
--
-- Correr tras configurar o migrar referencias de una línea:
--   SELECT * FROM audit_block_slug_refs('<linea_id>') WHERE NOT ok;
-- Vacío = capa de slugs sana.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.audit_block_slug_refs(p_linea_id uuid)
returns table(clase text, host_nombre text, slug_ref text, ok boolean, problema text)
language sql stable set search_path to 'public'
as $function$
with linea_slugs as (
  select bc.slug
  from bloque_configs bc join etapas_negocio e on e.id = bc.etapa_id
  where e.linea_id = p_linea_id and bc.slug is not null
),
base as (
  select bc.config_extra as ce, coalesce(nullif(bc.nombre,''), bd.nombre) as host_nombre
  from bloque_configs bc
  join etapas_negocio e on e.id = bc.etapa_id
  join bloque_definitions bd on bd.id = bc.bloque_definition_id
  where e.linea_id = p_linea_id
),
dups as (
  select 'slug_duplicado' as clase, bc.slug as host_nombre, bc.slug as slug_ref, false as ok,
         'slug repetido en la línea (' || count(*) || ' bloques)' as problema
  from bloque_configs bc join etapas_negocio e on e.id = bc.etapa_id
  where e.linea_id = p_linea_id and bc.slug is not null
  group by bc.slug having count(*) > 1
),
refs as (
  select 'readonly' as clase, host_nombre, ce->>'source_bloque_slug' as slug_ref
  from base where ce ? 'source_bloque_slug'
  union all
  select 'condition', host_nombre, ce->'condition'->>'source_bloque_slug'
  from base where ce->'condition' ? 'source_bloque_slug'
  union all
  select 'cross_check', host_nombre, chk->>'source_bloque_slug'
  from base, jsonb_array_elements(coalesce(ce->'cross_check'->'checks','[]')) chk
  where chk ? 'source_bloque_slug'
  union all
  select 'cross_check_alt', host_nombre, alt->>'source_bloque_slug'
  from base, jsonb_array_elements(coalesce(ce->'cross_check'->'checks','[]')) chk,
       jsonb_array_elements(coalesce(chk->'source_alternatives','[]')) alt
  where alt ? 'source_bloque_slug'
  union all
  select 'auto_fill', host_nombre, f->'auto_fill'->>'source_bloque_slug'
  from base, jsonb_array_elements(coalesce(ce->'fields','[]')) f
  where f->'auto_fill' ? 'source_bloque_slug'
  union all
  select 'campos_fuente', host_nombre, cf->'source'->>'bloque_slug'
  from base, jsonb_array_elements(coalesce(ce->'campos_fuente','[]')) cf
  where cf->'source' ? 'bloque_slug'
  union all
  select 'campos_fuente_alt', host_nombre, alt->>'bloque_slug'
  from base, jsonb_array_elements(coalesce(ce->'campos_fuente','[]')) cf,
       jsonb_array_elements(coalesce(cf->'source_alternatives','[]')) alt
  where alt ? 'bloque_slug'
  union all
  select 'doc_link', host_nombre, f->'doc_link'->>'source_bloque_slug'
  from base, jsonb_array_elements(coalesce(ce->'fields','[]')) f
  where f->'doc_link' ? 'source_bloque_slug'
)
select r.clase, r.host_nombre, r.slug_ref,
       (r.slug_ref in (select slug from linea_slugs)) as ok,
       case when r.slug_ref in (select slug from linea_slugs) then null
            else 'slug referenciado no existe como bloque de la línea' end as problema
from refs r
union all
select clase, host_nombre, slug_ref, ok, problema from dups
order by ok, clase;
$function$;
