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
