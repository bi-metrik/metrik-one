-- ============================================================================
-- Biblioteca de fotos (decisión de Mauricio del 2026-10-16). SOLO ESQUEMA.
--
-- `fotos_catalogo` (20261014221500) guardaba UNA foto por elemento (workspace, tipo, clave).
-- La biblioteca guarda hasta TRES por elemento, una marcada como principal: la propuesta
-- imprime la principal y, si caben en el mismo recuadro, hasta dos más.
--
--   · `principal`: la que sale primero. A lo sumo una por elemento (índice único parcial).
--   · `posicion`: el puesto de la foto en el elemento, 1, 2 o 3. Único por elemento: así la
--     base, no solo el código, impide una cuarta foto.
--   · origen `sitio_oficial`: la foto se tomó de la página oficial del hotel o del tour. Se
--     guarda la página (`fuente_url`) y la imagen (`imagen_url`) para saber de dónde salió.
--     El código solo la ofrece con el interruptor del workspace
--     (`config_extra.documento_viaje.fotos_sitio_oficial`), apagado por defecto: falta el
--     visto bueno de Emilio para uso comercial.
--
-- NO escribe ni corrige ninguna fila. Las columnas nuevas llevan un valor por defecto
-- constante (PostgreSQL 11+ lo guarda en el catálogo, sin reescribir la tabla): cada foto
-- que ya existe se lee como `principal = true`, `posicion = 1`, o sea, sigue siendo la foto
-- del elemento. Los CHECK nuevos aceptan todo lo que aceptaban los viejos.
-- ============================================================================

alter table public.fotos_catalogo
  add column principal  boolean  not null default true,
  add column posicion   smallint not null default 1,
  add column imagen_url text;

alter table public.fotos_catalogo
  add constraint fotos_catalogo_posicion_1_a_3 check (posicion between 1 and 3),
  add constraint fotos_catalogo_imagen_url_https check (
    imagen_url is null or (imagen_url like 'https://%' and length(imagen_url) <= 2000)
  );

-- Una foto por elemento → hasta tres (una por puesto), con una sola principal.
create unique index fotos_catalogo_una_por_posicion
  on public.fotos_catalogo (workspace_id, tipo, clave, posicion);
create unique index fotos_catalogo_una_principal
  on public.fotos_catalogo (workspace_id, tipo, clave) where principal;
drop index public.fotos_catalogo_una_por_clave;

-- El origen nuevo. Sin `if exists` a propósito: si el CHECK se llamara distinto, la
-- migración tiene que fallar, no dejar el viejo vivo.
alter table public.fotos_catalogo drop constraint fotos_catalogo_origen_check;
alter table public.fotos_catalogo add constraint fotos_catalogo_origen_check
  check (origen in ('wikimedia', 'asesora', 'sitio_oficial'));

-- La fuente: Commons como antes para todo lo que no es de un sitio oficial; la página
-- oficial, por https.
alter table public.fotos_catalogo drop constraint fotos_catalogo_fuente_url_check;
alter table public.fotos_catalogo add constraint fotos_catalogo_fuente_url_check check (
  fuente_url is null
  or (origen <> 'sitio_oficial' and fuente_url like 'https://commons.wikimedia.org/%')
  or (origen = 'sitio_oficial' and fuente_url like 'https://%' and length(fuente_url) <= 2000)
);

-- Una foto de un sitio oficial sin su página y su imagen no se puede rastrear.
alter table public.fotos_catalogo add constraint fotos_catalogo_sitio_oficial_trazable check (
  origen <> 'sitio_oficial' or (fuente_url is not null and imagen_url is not null)
);

comment on column public.fotos_catalogo.principal is
  'La foto que sale primero en la propuesta. Una sola por (workspace, tipo, clave).';
comment on column public.fotos_catalogo.posicion is
  'Puesto de la foto en su elemento (1 a 3). Único por elemento: tope de tres fotos.';
comment on column public.fotos_catalogo.imagen_url is
  'Origen sitio_oficial: la URL de la imagen bajada (fuente_url es la página donde estaba).';
