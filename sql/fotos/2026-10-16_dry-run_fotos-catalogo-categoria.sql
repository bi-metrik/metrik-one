-- Dry-run de supabase/migrations/20261016221500_fotos_catalogo_categoria.sql contra producción.
--
-- UN solo statement: cuenta las filas de `fotos_catalogo`, aplica la migración (cuerpo pegado TAL
-- CUAL entre $mig$), ensaya el CHECK (un valor válido pasa, uno inválido falla) DENTRO de un
-- subbloque que se deshace, vuelve a contar y aborta con RAISE EXCEPTION. Nada queda escrito: el
-- resultado vuelve en el mensaje del error. Correrlo por MCP execute_sql y después confirmar:
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'fotos_catalogo' and column_name = 'categoria';  -- 0
--
-- Lo que tiene que decir:
--   ya_existia = false (la columna no estaba)
--   filas_antes = filas_despues (no escribe filas)
--   todas_null = true (las filas que ya existen quedan sin categoría)
--   check_valido = true ('habitacion' pasa), check_invalido = true ('no_es_hotel' lo frena el CHECK)
--   tipo = 'text', nullable = 'YES'
-- Si el mensaje no empieza por «DRY-RUN OK», algo no cuadra: NO aplicar.

DO $dry$
DECLARE
  ya_existia      boolean;
  filas_antes     bigint;
  filas_despues   bigint;
  todas_null      boolean;
  check_valido    boolean := false;
  check_invalido  boolean := false;
  tipo_col        text;
  nulo_col        text;
  una             uuid;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'fotos_catalogo' AND column_name = 'categoria'
  ) INTO ya_existia;
  SELECT count(*) INTO filas_antes FROM public.fotos_catalogo;

  EXECUTE $mig$
alter table public.fotos_catalogo
  add column categoria text;

alter table public.fotos_catalogo
  add constraint fotos_catalogo_categoria_check check (
    categoria is null or categoria in ('fachada', 'habitacion', 'zonas_comunes', 'otra')
  );

comment on column public.fotos_catalogo.categoria is
  'Hotel: fachada, habitacion, zonas_comunes u otra (la pestaña donde la asesora la eligió). NULL = sin categoría (filas de antes del 2026-10-16, ciudades y actividades).';
  $mig$;

  SELECT count(*), bool_and(categoria IS NULL) INTO filas_despues, todas_null FROM public.fotos_catalogo;
  SELECT data_type, is_nullable INTO tipo_col, nulo_col
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'fotos_catalogo' AND column_name = 'categoria';

  -- El CHECK, sobre una fila cualquiera (si la hay), en subbloques que se deshacen solos.
  SELECT id INTO una FROM public.fotos_catalogo LIMIT 1;
  IF una IS NOT NULL THEN
    BEGIN
      UPDATE public.fotos_catalogo SET categoria = 'habitacion' WHERE id = una;
      check_valido := true;
      RAISE EXCEPTION 'deshacer';
    EXCEPTION WHEN raise_exception THEN NULL;
    END;
    BEGIN
      UPDATE public.fotos_catalogo SET categoria = 'no_es_hotel' WHERE id = una;
    EXCEPTION WHEN check_violation THEN check_invalido := true;
    END;
  END IF;

  RAISE EXCEPTION '% ya_existia=% filas_antes=% filas_despues=% todas_null=% check_valido=% check_invalido=% tipo=% nullable=%',
    CASE WHEN NOT ya_existia AND filas_antes = filas_despues AND coalesce(todas_null, true)
              AND tipo_col = 'text' AND nulo_col = 'YES'
              AND (una IS NULL OR (check_valido AND check_invalido))
         THEN 'DRY-RUN OK' ELSE 'DRY-RUN NO CUADRA' END,
    ya_existia, filas_antes, filas_despues, coalesce(todas_null, true), check_valido, check_invalido, tipo_col, nulo_col;
END
$dry$;
