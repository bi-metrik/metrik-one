-- Dry-run de supabase/migrations/20261019203000_proveedores_motor_v13.sql contra producción.
--
-- UN solo statement: cuenta lo que existe; aplica la migración (cuerpo pegado TAL CUAL entre
-- $mig$); ensaya las reglas nuevas DENTRO de un subbloque que se deshace; vuelve a contar y aborta
-- con RAISE EXCEPTION. Nada queda escrito: el resultado vuelve en el mensaje del error. Correrlo
-- por MCP execute_sql y después confirmar que no quedó nada:
--   select count(*) from information_schema.columns where table_schema = 'public'
--      and ((table_name = 'proveedor_extracciones' and column_name in ('vigencia_desde', 'vigencia_hasta', 'vigencia_por', 'monedas'))
--        or (table_name = 'fotos_perfiles' and column_name in ('tarifario_de_id', 'tarifario_establecimiento')));   -- 0
--
-- Lo que tiene que decir:
--   ya_existia = false
--   perfiles_antes = perfiles_despues, extracciones_antes = extracciones_despues (no escribe datos)
--   revisadas_antes = 0 (si hubiera una extracción ya «revisada» sin vigencia, el CHECK no entra)
--   nulos = true (las columnas nuevas nacen NULL, y `monedas` en {})
--   Ensayos (solo si hay un perfil de proveedor en algún workspace):
--   cerrar_sin_vigencia = true (una carga cerrada sin vigencia la frena el CHECK),
--   cerrar = true (con vigencia, entra), fechas = true (hasta < desde lo frena el CHECK),
--   monedas = true (un `monedas` que no es objeto lo frena el CHECK),
--   mismo = true (una ficha no toma el tarifario de sí misma),
--   cadena = true (una ficha toma el de otra del mismo workspace; null si el workspace tiene una sola),
--   cadena_ws = true (la de otro workspace la frena la llave compuesta; true si no hay otro workspace con fichas)
-- Si el mensaje no empieza por «DRY-RUN OK», algo no cuadra: NO aplicar.

DO $dry$
DECLARE
  ya_existia            boolean;
  perfiles_antes        bigint;
  perfiles_despues      bigint;
  extracciones_antes    bigint;
  extracciones_despues  bigint;
  revisadas_antes       bigint;
  nulos                 boolean;
  ensayado              boolean := false;
  cerrar_sin_vigencia   boolean := false;
  cerrar                boolean := false;
  fechas                boolean := false;
  monedas               boolean := false;
  mismo                 boolean := false;
  cadena                boolean := null;
  cadena_ws             boolean := false;
  perfil                uuid;
  otro_perfil           uuid;
  ws                    uuid;
  perfil_otro_ws        uuid;
  ext                   uuid;
  ana                   uuid;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND ((table_name = 'proveedor_extracciones' AND column_name IN ('vigencia_desde', 'monedas'))
                   OR (table_name = 'fotos_perfiles' AND column_name IN ('tarifario_de_id', 'tarifario_establecimiento'))))
    INTO ya_existia;
  SELECT count(*) INTO perfiles_antes FROM public.fotos_perfiles;
  SELECT count(*) INTO extracciones_antes FROM public.proveedor_extracciones;
  SELECT count(*) INTO revisadas_antes FROM public.proveedor_extracciones WHERE estado = 'revisada';

  EXECUTE $mig$
-- ============================================================================
-- Motor de extracción v13 en ONE (Trappvel, decisiones de Mauricio del 2026-10-19).
--
--   · `proveedor_extracciones` (esquema 0.2 y ahora 0.3) gana lo que decide la persona al cerrar
--     la carga de un tarifario:
--       - `vigencia_desde` / `vigencia_hasta`: la vigencia CONFIRMADA. Si el motor no la fijó o la
--         marcó `requiere_confirmacion`, la escribe la persona (no se infiere del nombre del
--         archivo ni de la fecha de carga). `vigencia_por` dice quién la puso.
--       - `monedas`: los cambios de moneda de la revisión (todo el tarifario, por establecimiento
--         o por fila). `{}` = la que propuso el motor en cada fila.
--       - Una extracción solo pasa a `revisada` (la carga cerrada, la única que cuenta para
--         cotizar) con vigencia completa: lo exige un CHECK.
--   · `fotos_perfiles` (la ficha) gana el tarifario de cadena: un PDF puede cubrir varios hoteles
--       - `tarifario_de_id`: la ficha de la que esta ficha toma el tarifario (la que tiene el PDF
--         de la cadena). NULL = el suyo.
--       - `tarifario_establecimiento`: cuál de los establecimientos del tarifario es esta ficha.
--         Solo esas filas cuentan para cotizarla.
--
-- NO escribe datos: columnas que nacen NULL (o `{}`), dos CHECK y una llave foránea.
--
-- epoca: no-rompe solo agrega columnas con valor por defecto y restricciones; el código de antes no las nombra
--
-- ⚠️ Aplicar ANTES del merge. Depende de `20261019130000_proveedores_temporadas_iva.sql` (aplicada).
-- Dry-run: sql/proveedores/2026-10-19_dry-run_motor-v13.sql
-- Reversa: sql/proveedores/2026-10-19_reversa_motor-v13.sql
-- ============================================================================

-- ── 1. La carga de una extracción: vigencia confirmada y monedas ─────────────

alter table public.proveedor_extracciones
  add column vigencia_desde date,
  add column vigencia_hasta date,
  add column vigencia_por   text check (vigencia_por is null or vigencia_por in ('motor', 'persona')),
  add column monedas        jsonb not null default '{}'::jsonb check (jsonb_typeof(monedas) = 'object' and octet_length(monedas::text) <= 200000);

alter table public.proveedor_extracciones add constraint proveedor_extracciones_vigencia
  check (vigencia_hasta is null or vigencia_desde is null or vigencia_hasta >= vigencia_desde);

-- La carga cerrada (la única que cuenta para cotizar) exige la vigencia completa y quién la cerró.
alter table public.proveedor_extracciones add constraint proveedor_extracciones_revisada_con_vigencia
  check (estado <> 'revisada' or (vigencia_desde is not null and vigencia_hasta is not null and vigencia_por is not null and revisada_at is not null));

comment on column public.proveedor_extracciones.vigencia_desde is
  'Vigencia confirmada al cerrar la carga. La escribe la persona cuando el motor no la fijó o la marcó requiere_confirmacion; nunca se infiere del nombre del archivo ni de la fecha de carga.';
comment on column public.proveedor_extracciones.monedas is
  'Cambios de moneda de la revisión: {"tarifario": "USD", "establecimientos": {"Hotel X": "USD"}, "filas": {"12": "EUR"}}. Manda la más específica; {} = la del motor en cada fila.';
comment on table public.proveedor_extracciones is
  'Salida del motor de extracción de tarifarios por proveedor (esquema 0.2 o 0.3: expediente + tarifario + datos_ficha). server-only. Una fila por corrida; la vigente es la última no descartada; solo una revisada (carga cerrada con vigencia) cuenta para cotizar.';

-- ── 2. El tarifario de cadena en varias fichas ───────────────────────────────

alter table public.fotos_perfiles
  add column tarifario_de_id           uuid,
  add column tarifario_establecimiento text check (tarifario_establecimiento is null or length(btrim(tarifario_establecimiento)) between 1 and 200);

alter table public.fotos_perfiles add constraint fotos_perfiles_tarifario_de_fk
  foreign key (tarifario_de_id, workspace_id) references public.fotos_perfiles (id, workspace_id)
  on delete set null (tarifario_de_id);
alter table public.fotos_perfiles add constraint fotos_perfiles_tarifario_de_no_es_el_mismo
  check (tarifario_de_id is null or tarifario_de_id <> id);

create index idx_fotos_perfiles_tarifario_de
  on public.fotos_perfiles (tarifario_de_id) where tarifario_de_id is not null;

comment on column public.fotos_perfiles.tarifario_de_id is
  'La ficha de la que esta toma el tarifario (un PDF de cadena para varios hoteles). NULL = el suyo.';
comment on column public.fotos_perfiles.tarifario_establecimiento is
  'Cuál establecimiento del tarifario (tarifas[].establecimiento) es esta ficha. Solo esas filas cuentan para cotizar.';
$mig$;

  SELECT count(*) INTO perfiles_despues FROM public.fotos_perfiles;
  SELECT count(*) INTO extracciones_despues FROM public.proveedor_extracciones;
  EXECUTE $q$
    SELECT NOT EXISTS (SELECT 1 FROM public.fotos_perfiles WHERE tarifario_de_id IS NOT NULL OR tarifario_establecimiento IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.proveedor_extracciones WHERE vigencia_desde IS NOT NULL OR vigencia_hasta IS NOT NULL OR vigencia_por IS NOT NULL OR monedas <> '{}'::jsonb)
  $q$ INTO nulos;

  SELECT id, workspace_id INTO perfil, ws FROM public.fotos_perfiles ORDER BY created_at LIMIT 1;
  IF perfil IS NOT NULL THEN
    ensayado := true;
    SELECT id INTO otro_perfil FROM public.fotos_perfiles WHERE workspace_id = ws AND id <> perfil ORDER BY created_at LIMIT 1;
    SELECT id INTO perfil_otro_ws FROM public.fotos_perfiles WHERE workspace_id <> ws ORDER BY created_at LIMIT 1;
    SELECT id INTO ana FROM public.staff WHERE workspace_id = ws LIMIT 1;
    BEGIN
      EXECUTE $q$ INSERT INTO public.proveedor_extracciones (workspace_id, proveedor_id, esquema_version, expediente)
                  VALUES ($1, $2, '0.3', '{"archivos": []}'::jsonb) RETURNING id $q$ INTO ext USING ws, perfil;
      BEGIN
        EXECUTE $q$ UPDATE public.proveedor_extracciones SET estado = 'revisada', revisada_por = $2, revisada_at = now() WHERE id = $1 $q$ USING ext, ana;
      EXCEPTION WHEN check_violation THEN cerrar_sin_vigencia := true;
      END;
      EXECUTE $q$ UPDATE public.proveedor_extracciones SET estado = 'revisada', revisada_por = $2, revisada_at = now(),
                  vigencia_desde = DATE '2027-01-01', vigencia_hasta = DATE '2027-12-31', vigencia_por = 'persona',
                  monedas = '{"tarifario": "USD"}'::jsonb WHERE id = $1 $q$ USING ext, ana;
      cerrar := true;
      BEGIN
        EXECUTE $q$ UPDATE public.proveedor_extracciones SET vigencia_hasta = DATE '2026-01-01' WHERE id = $1 $q$ USING ext;
      EXCEPTION WHEN check_violation THEN fechas := true;
      END;
      BEGIN
        EXECUTE $q$ UPDATE public.proveedor_extracciones SET monedas = '["USD"]'::jsonb WHERE id = $1 $q$ USING ext;
      EXCEPTION WHEN check_violation THEN monedas := true;
      END;
      BEGIN
        EXECUTE $q$ UPDATE public.fotos_perfiles SET tarifario_de_id = id WHERE id = $1 $q$ USING perfil;
      EXCEPTION WHEN check_violation THEN mismo := true;
      END;
      IF otro_perfil IS NOT NULL THEN
        EXECUTE $q$ UPDATE public.fotos_perfiles SET tarifario_de_id = $2, tarifario_establecimiento = 'Hotel de ensayo' WHERE id = $1 $q$ USING otro_perfil, perfil;
        cadena := true;
      END IF;
      IF perfil_otro_ws IS NOT NULL THEN
        BEGIN
          EXECUTE $q$ UPDATE public.fotos_perfiles SET tarifario_de_id = $2 WHERE id = $1 $q$ USING perfil_otro_ws, perfil;
        EXCEPTION WHEN foreign_key_violation THEN cadena_ws := true;
        END;
      ELSE
        cadena_ws := true;
      END IF;
      RAISE EXCEPTION 'deshacer';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'deshacer' THEN RAISE; END IF;
    END;
  END IF;

  RAISE EXCEPTION '% ya_existia=% perfiles_antes=% perfiles_despues=% extracciones_antes=% extracciones_despues=% revisadas_antes=% nulos=% ensayado=% cerrar_sin_vigencia=% cerrar=% fechas=% monedas=% mismo=% cadena=% cadena_ws=%',
    CASE WHEN NOT ya_existia AND perfiles_antes = perfiles_despues AND extracciones_antes = extracciones_despues AND revisadas_antes = 0 AND nulos
              AND (NOT ensayado OR (cerrar_sin_vigencia AND cerrar AND fechas AND monedas AND mismo AND coalesce(cadena, true) AND cadena_ws))
         THEN 'DRY-RUN OK' ELSE 'DRY-RUN NO CUADRA' END,
    ya_existia, perfiles_antes, perfiles_despues, extracciones_antes, extracciones_despues, revisadas_antes, nulos,
    ensayado, cerrar_sin_vigencia, cerrar, fechas, monedas, mismo, cadena, cadena_ws;
END
$dry$;
