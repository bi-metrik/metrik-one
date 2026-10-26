-- Reversa de supabase/migrations/20261019203000_proveedores_motor_v13.sql.
--
-- SE PIERDE: la vigencia confirmada y los cambios de moneda de cada carga de tarifario, y qué
-- ficha toma el tarifario de qué otra (y con qué establecimiento). Las extracciones quedan, pero
-- las que estaban «revisadas» vuelven a borrador para que nadie cotice con una carga sin su
-- vigencia confirmada. Correr SOLO después de revertir el código que las lee. Y borrar la fila del
-- ledger:
--   delete from supabase_migrations.schema_migrations where version = '20261019203000';

update public.proveedor_extracciones set estado = 'borrador', revisada_por = null, revisada_at = null where estado = 'revisada';

alter table public.proveedor_extracciones
  drop constraint if exists proveedor_extracciones_revisada_con_vigencia,
  drop constraint if exists proveedor_extracciones_vigencia,
  drop column if exists vigencia_desde,
  drop column if exists vigencia_hasta,
  drop column if exists vigencia_por,
  drop column if exists monedas;

comment on table public.proveedor_extracciones is
  'Salida del motor de extracción de tarifarios por proveedor (esquema 0.2: expediente + tarifario + datos_ficha). server-only. Una fila por corrida; la vigente es la última no descartada.';

drop index if exists public.idx_fotos_perfiles_tarifario_de;
alter table public.fotos_perfiles
  drop constraint if exists fotos_perfiles_tarifario_de_no_es_el_mismo,
  drop constraint if exists fotos_perfiles_tarifario_de_fk,
  drop column if exists tarifario_de_id,
  drop column if exists tarifario_establecimiento;
