-- ============================================================
-- Casos reales para el eval de Haiku 5.5 (scripts/eval-haiku/). SOLO SELECT.
-- ------------------------------------------------------------
-- Cada consulta devuelve filas (familia, id, entrada, oraculo). El oráculo es lo que quedó guardado: la salida de
-- Gemini que se aceptó o la corrección de una persona. No hay una llamada nueva a Gemini.
--
-- Cómo: correr cada bloque por el MCP de Supabase (execute_sql, proyecto yfjqscvvxetobiidnepa) y guardar el
-- resultado como arreglo JSON en scripts/eval-haiku/casos/<familia>.json (esa carpeta está en .gitignore: los casos
-- traen datos de clientes). Formato de cada elemento: {"familia","id","entrada","oraculo"}.
--
-- Filtro de workspace: cada caso lleva su workspace_id. Para acotar a un cliente, agregar
--   and <alias>.workspace_id = '<uuid>'
-- en el WHERE del bloque.
-- ============================================================

-- 1. gastos — clasificar-gasto-ia (descripción → categoría + clasificación).
--    Primero los revisados por una persona (oráculo humano).
select 'gastos' as familia, g.id::text as id,
  jsonb_build_object('descripcion', g.descripcion, 'workspace_id', g.workspace_id) as entrada,
  jsonb_build_object('categoria', g.categoria, 'clasificacion', g.clasificacion_costo, 'revisado', coalesce(g.revisado, false)) as oraculo
from public.gastos g
where length(trim(coalesce(g.descripcion, ''))) >= 3
  and g.categoria is not null
order by coalesce(g.revisado, false) desc, g.created_at desc
limit 60;

-- 2. intencion_wa — wa-parse del bot de WhatsApp (mensaje → intención). Solo lo que resolvió el modelo
--    (parser_source = 'gemini'), con el mensaje entero (el preview se corta a 100 caracteres).
select 'intencion_wa' as familia, l.id::text as id,
  jsonb_build_object('texto', l.message_preview, 'workspace_id', l.workspace_id) as entrada,
  jsonb_build_object('intent', l.intent, 'confidence', l.confidence, 'modelo', l.gemini_model) as oraculo
from public.wa_message_log l
where l.direction = 'inbound'
  and l.parser_source = 'gemini'
  and l.intent is not null
  and length(coalesce(l.message_preview, '')) between 3 and 99
order by l.created_at desc
limit 80;

-- 3. documento — extract-fields sobre el archivo de un bloque de documento. El oráculo es `data.campos` (con
--    `edicion` cuando una persona lo corrigió). Primero los que tienen correcciones humanas.
select 'documento' as familia, nb.id::text as id,
  jsonb_build_object(
    'workspace_id', n.workspace_id,
    'mime', nb.data->>'mime_type',
    'file_name', nb.data->>'file_name',
    'drive_file_id', nb.data->>'drive_file_id',
    'drive_url', nb.data->>'drive_url',
    'campos', bc.config_extra->'campos_extraccion'
  ) as entrada,
  jsonb_build_object('campos', nb.data->'campos') as oraculo
from public.negocio_bloques nb
join public.negocios n on n.id = nb.negocio_id
join public.bloque_configs bc on bc.id = nb.bloque_config_id
where nb.data ? 'campos'
  and nb.data->>'_extraction_status' = 'ok'
  and jsonb_typeof(bc.config_extra->'campos_extraccion') = 'array'
  and jsonb_array_length(bc.config_extra->'campos_extraccion') > 0
  and (nb.data->>'drive_file_id' is not null or nb.data->>'drive_url' like 'one://%')
order by (select count(*) from jsonb_each(nb.data->'campos') e where e.value ? 'edicion') desc, nb.updated_at desc
limit 40;

-- 4. rut — parse-rut. El oráculo es la empresa CONFIRMADA por una persona (rut_verificado), y el archivo es el
--    último RUT subido a rut-documents para esa empresa.
select 'rut' as familia, e.id::text as id,
  jsonb_build_object('workspace_id', e.workspace_id, 'bucket', 'rut-documents', 'path', o.name, 'mime', o.metadata->>'mimetype') as entrada,
  jsonb_build_object(
    'nit', e.numero_documento, 'razon_social', e.razon_social, 'tipo_persona', e.tipo_persona,
    'tipo_documento', e.tipo_documento, 'regimen_tributario', e.regimen_tributario,
    'direccion_fiscal', e.direccion_fiscal, 'municipio', e.municipio, 'departamento', e.departamento,
    'telefono', e.telefono, 'email_fiscal', e.email_fiscal, 'actividad_ciiu', e.actividad_ciiu,
    'responsable_iva', e.responsable_iva, 'gran_contribuyente', e.gran_contribuyente,
    'agente_retenedor', e.agente_retenedor, 'autorretenedor', e.autorretenedor,
    'fecha_inicio_actividades', e.fecha_inicio_actividades
  ) as oraculo
from public.empresas e
join lateral (
  select so.name, so.metadata from storage.objects so
  where so.bucket_id = 'rut-documents' and so.name like e.workspace_id::text || '/empresas/' || e.id::text || '/rut\_%'
  order by so.created_at desc limit 1
) o on true
where e.rut_verificado is true
order by e.rut_fecha_carga desc nulls last
limit 30;

-- 5. acta — generacion.ts. La transcripción vive en Drive (transcript_file_id): el arnés la exporta como texto.
select 'acta' as familia, a.id::text as id,
  jsonb_build_object('workspace_id', a.workspace_id, 'transcript_file_id', a.transcript_file_id, 'titulo', a.titulo,
    'tipo', a.tipo, 'duracion_segundos', a.duracion_segundos, 'participantes', a.participantes) as entrada,
  jsonb_build_object('resumen', a.resumen, 'decisiones', a.decisiones, 'compromisos', a.compromisos) as oraculo
from public.actas_generadas a
where a.transcript_file_id is not null and a.resumen is not null
order by a.created_at desc
limit 10;

-- Sin consulta (no hay oráculo guardado en la base):
--   · decidir-destino: la decisión del modelo no se guarda («nunca escribe»), solo el lugar final del ítem.
--   · capturas (detectar-tipo / extraer-ranura): la imagen llega como data URL y no se guarda.
--   · bot conversacional (núcleo con herramientas): se evalúa con su arnés propio (ver README.md).
