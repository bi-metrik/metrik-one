-- ============================================================================
-- Fotos del hotel por categoría (Mauricio, 2026-10-16). SOLO ESQUEMA.
--
-- La biblioteca de fotos (`fotos_catalogo`, 20261014221500 + 20261016153000) guarda hasta tres
-- fotos por elemento. Para un HOTEL, la asesora ahora elige por pestaña —Fachada, Habitaciones,
-- Zonas comunes— y la propuesta lleva, de preferencia, una de cada una. La categoría queda en la
-- fila:
--   · 'fachada'        el hotel por fuera;
--   · 'habitacion'     una habitación por dentro;
--   · 'zonas_comunes'  lobby, restaurante, piscina, terraza…;
--   · 'otra'           elegida sin decir cuál.
-- NULL = sin categoría: todas las filas que ya existen, y las ciudades y actividades. El código
-- clasifica UNA vez con el modelo las fotos de hotel sin categoría cuando alguien abre su
-- selector, y guarda el resultado aquí (para no volver a preguntar).
--
-- NO escribe ni corrige ninguna fila: la columna nueva es nullable y sin valor por defecto
-- (no reescribe la tabla). El CHECK solo mira la columna nueva.
--
-- ⚠️ Aplicar ANTES del merge: el código lee `categoria` en cada consulta de la biblioteca; sin la
-- columna la biblioteca dice «falta aplicar la migración» y la propuesta sale sin fotos de la
-- biblioteca.
-- Dry-run: sql/fotos/2026-10-16_dry-run_fotos-catalogo-categoria.sql
-- Reversa: sql/fotos/2026-10-16_reversa_fotos-catalogo-categoria.sql
-- ============================================================================

alter table public.fotos_catalogo
  add column categoria text;

alter table public.fotos_catalogo
  add constraint fotos_catalogo_categoria_check check (
    categoria is null or categoria in ('fachada', 'habitacion', 'zonas_comunes', 'otra')
  );

comment on column public.fotos_catalogo.categoria is
  'Hotel: fachada, habitacion, zonas_comunes u otra (la pestaña donde la asesora la eligió). NULL = sin categoría (filas de antes del 2026-10-16, ciudades y actividades).';
