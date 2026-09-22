-- El texto que ONE redacta para el documento del cliente (Trappvel) y que el equipo corrige.
--
-- Una columna por COTIZACIÓN, no por negocio: lo que el plan incluye depende de las líneas
-- de esa cotización, y un negocio puede tener varias versiones.
--
-- Forma (la escribe y la lee solo el código, `src/lib/cotizaciones/documento-cliente.ts`):
--   { titular, intro, incluye[], antes_de_viajar[],
--     origen: 'ia' | 'persona', modelo, redactado_en, fuente_hash,
--     revisado_por, revisado_por_nombre, revisado_en }
-- El PDF imprime SOLO un texto con `revisado_en`: un borrador del modelo no le llega al
-- cliente sin que una persona lo haya leído.
--
-- ADITIVA: sin backfill (NULL = no hay texto, y el documento sale como hoy) y sin cambios de
-- RLS ni de grants. Verificado en producción el 2026-09-22 (solo lectura): `cotizaciones`
-- tiene RLS encendido, una sola policy `cotizaciones_ws` (ALL, por
-- `current_user_workspace_id()`), grants de tabla a `authenticated` y ningún grant por
-- columna, así que la columna nueva queda cubierta por lo que ya existe.

alter table public.cotizaciones
  add column if not exists documento_cliente jsonb;

alter table public.cotizaciones
  drop constraint if exists cotizaciones_documento_cliente_es_objeto;

alter table public.cotizaciones
  add constraint cotizaciones_documento_cliente_es_objeto
  check (documento_cliente is null or jsonb_typeof(documento_cliente) = 'object');

comment on column public.cotizaciones.documento_cliente is
  'Texto del documento del cliente (titular, intro, incluye, antes de viajar) redactado por ONE y revisado por el equipo. Solo se imprime con revisado_en.';

-- Vuelta atrás:
-- alter table public.cotizaciones drop constraint if exists cotizaciones_documento_cliente_es_objeto;
-- alter table public.cotizaciones drop column if exists documento_cliente;
