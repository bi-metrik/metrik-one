-- ============================================================================
-- Autorización de las fotos subidas a la biblioteca (Emilio, 2026-10-16). SOLO ESQUEMA.
--
-- Al subir o pegar una foto a `fotos_catalogo`, la persona marca «Tengo autorización para usar
-- esta foto» y ONE guarda quién la subió, cuándo y de dónde viene:
--   · `autorizada_por`  el usuario (auth.users) que marcó la casilla;
--   · `autorizada_at`   cuándo;
--   · `procedencia`     texto libre opcional: «kit de medios del hotel», «mayorista X».
-- Lo escribe el servidor de ONE (la acción pone el usuario y la hora; el navegador solo manda la
-- casilla y el texto). Las de Commons y la página oficial quedan en NULL: su fuente ya está en
-- `fuente_url`, `autor` y `licencia`.
--
-- NO escribe ni corrige ninguna fila: las tres columnas son nullable y sin valor por defecto (no
-- reescribe la tabla). Las fotos subidas antes de hoy quedan sin autorización registrada; no se
-- inventa. Los CHECK solo miran las columnas nuevas.
--
-- ⚠️ Aplicar ANTES del merge: el código escribe estas columnas en cada foto que se guarda en la
-- biblioteca (también las de Commons, en NULL, para que un reemplazo no herede la autorización de
-- la foto anterior). Sin ellas, guardar una foto dice «falta aplicar la migración»; LEER la
-- biblioteca y el PDF siguen como hoy.
-- Dry-run: sql/fotos/2026-10-16_dry-run_fotos-catalogo-autorizacion.sql
-- Reversa: sql/fotos/2026-10-16_reversa_fotos-catalogo-autorizacion.sql
-- ============================================================================

alter table public.fotos_catalogo
  add column autorizada_por uuid references auth.users(id) on delete set null,
  add column autorizada_at  timestamptz,
  add column procedencia    text;

alter table public.fotos_catalogo
  add constraint fotos_catalogo_procedencia_check check (
    procedencia is null or length(btrim(procedencia)) between 1 and 200
  ),
  -- Quien autorizó va siempre con su fecha (si el usuario se borra, queda la fecha sola).
  add constraint fotos_catalogo_autorizada_con_fecha check (
    autorizada_por is null or autorizada_at is not null
  );

comment on column public.fotos_catalogo.autorizada_por is
  'Foto subida o pegada: el usuario que marcó «Tengo autorización para usar esta foto». NULL en Commons, página oficial y fotos subidas antes del 2026-10-16.';
comment on column public.fotos_catalogo.autorizada_at is
  'Cuándo se marcó la autorización de la foto subida.';
comment on column public.fotos_catalogo.procedencia is
  'De dónde viene la foto subida, en palabras de quien la subió («kit de medios del hotel», «mayorista X»). Opcional.';
