-- Dry-run de supabase/migrations/20261016233000_fotos_catalogo_autorizacion.sql contra producción.
--
-- UN solo statement: cuenta las filas de `fotos_catalogo`, aplica la migración (cuerpo pegado TAL
-- CUAL entre $mig$), ensaya los CHECK y la llave foránea DENTRO de subbloques que se deshacen,
-- vuelve a contar y aborta con RAISE EXCEPTION. Nada queda escrito: el resultado vuelve en el
-- mensaje del error. Correrlo por MCP execute_sql y después confirmar:
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'fotos_catalogo'
--      and column_name in ('autorizada_por', 'autorizada_at', 'procedencia');  -- 0
--
-- Lo que tiene que decir:
--   ya_existia = false (ninguna de las tres columnas estaba)
--   filas_antes = filas_despues (no escribe filas)
--   todas_null = true (las filas que ya existen quedan sin autorización registrada)
--   valida = true (usuario real + fecha + «kit de medios del hotel» pasa)
--   sin_fecha = true (usuario sin fecha lo frena el CHECK)
--   procedencia_vacia = true (una procedencia en blanco la frena el CHECK)
--   usuario_inexistente = true (un uuid que no es usuario lo frena la llave foránea)
-- (los ensayos sobre filas solo corren si hay al menos una foto y un usuario)
-- Si el mensaje no empieza por «DRY-RUN OK», algo no cuadra: NO aplicar.

DO $dry$
DECLARE
  ya_existia          boolean;
  filas_antes         bigint;
  filas_despues       bigint;
  todas_null          boolean;
  valida              boolean := false;
  sin_fecha           boolean := false;
  procedencia_vacia   boolean := false;
  usuario_inexistente boolean := false;
  una                 uuid;
  usuario             uuid;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'fotos_catalogo'
       AND column_name IN ('autorizada_por', 'autorizada_at', 'procedencia')
  ) INTO ya_existia;
  SELECT count(*) INTO filas_antes FROM public.fotos_catalogo;

  EXECUTE $mig$
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
  $mig$;

  SELECT count(*), bool_and(autorizada_por IS NULL AND autorizada_at IS NULL AND procedencia IS NULL)
    INTO filas_despues, todas_null FROM public.fotos_catalogo;

  SELECT id INTO una FROM public.fotos_catalogo LIMIT 1;
  SELECT id INTO usuario FROM auth.users LIMIT 1;
  IF una IS NOT NULL AND usuario IS NOT NULL THEN
    BEGIN
      UPDATE public.fotos_catalogo SET autorizada_por = usuario, autorizada_at = now(), procedencia = 'kit de medios del hotel' WHERE id = una;
      valida := true;
      RAISE EXCEPTION 'deshacer';
    EXCEPTION WHEN raise_exception THEN NULL;
    END;
    BEGIN
      UPDATE public.fotos_catalogo SET autorizada_por = usuario, autorizada_at = NULL WHERE id = una;
    EXCEPTION WHEN check_violation THEN sin_fecha := true;
    END;
    BEGIN
      UPDATE public.fotos_catalogo SET procedencia = '   ' WHERE id = una;
    EXCEPTION WHEN check_violation THEN procedencia_vacia := true;
    END;
    BEGIN
      UPDATE public.fotos_catalogo SET autorizada_por = '00000000-0000-4000-8000-00000000dead', autorizada_at = now() WHERE id = una;
    EXCEPTION WHEN foreign_key_violation THEN usuario_inexistente := true;
    END;
  END IF;

  RAISE EXCEPTION '% ya_existia=% filas_antes=% filas_despues=% todas_null=% valida=% sin_fecha=% procedencia_vacia=% usuario_inexistente=%',
    CASE WHEN NOT ya_existia AND filas_antes = filas_despues AND coalesce(todas_null, true)
              AND (una IS NULL OR usuario IS NULL OR (valida AND sin_fecha AND procedencia_vacia AND usuario_inexistente))
         THEN 'DRY-RUN OK' ELSE 'DRY-RUN NO CUADRA' END,
    ya_existia, filas_antes, filas_despues, coalesce(todas_null, true), valida, sin_fecha, procedencia_vacia, usuario_inexistente;
END
$dry$;
