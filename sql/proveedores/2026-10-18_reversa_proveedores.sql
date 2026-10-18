-- Reversa de supabase/migrations/20261018150000_proveedores.sql.
--
-- Quita los tarifarios, las cuentas bancarias y su historial, las columnas de la ficha y el espacio
-- `proveedor`. SE PIERDE: la ficha (contacto, etiquetas, responsable, «se compra a través de»),
-- los tarifarios registrados, las cuentas y su rastro, y los proveedores sin fotos (espacio
-- `proveedor`: mayoristas, transportadores, operadores importados). Los archivos de tarifarios y
-- certificados quedan huérfanos en el bucket (prefijo `<ws>/proveedores/`).
-- NO se tocan los perfiles de hotel y de tour, sus alias ni sus FOTOS: la propuesta sale igual.
-- Correr SOLO después de revertir el código que los lee. Y borrar la fila del ledger:
--   delete from supabase_migrations.schema_migrations where version = '20261018150000';

drop table if exists public.proveedor_cuentas_historial;
drop table if exists public.proveedor_cuentas;
drop table if exists public.proveedor_tarifarios;
drop function if exists public.proveedor_cuentas_rastro();
drop function if exists public.proveedor_cuentas_cambio();

drop trigger if exists fotos_perfiles_ficha_proveedor on public.fotos_perfiles;
drop function if exists public.fotos_perfiles_ficha_proveedor();

-- Los proveedores sin fotos no caben en el CHECK de antes.
delete from public.fotos_perfiles where tipo = 'proveedor';

alter table public.fotos_perfiles drop constraint if exists fotos_perfiles_comprado_via_fk;
alter table public.fotos_perfiles drop constraint if exists fotos_perfiles_comprado_via_no_es_el_mismo;
alter table public.fotos_perfiles drop constraint if exists fotos_perfiles_id_ws;
drop index if exists public.fotos_perfiles_una_por_origen_ref;
drop index if exists public.idx_fotos_perfiles_tipo_proveedor;
drop index if exists public.idx_fotos_perfiles_etiquetas;
drop index if exists public.idx_fotos_perfiles_responsable_tarifas;
drop index if exists public.idx_fotos_perfiles_comprado_via;
alter table public.fotos_perfiles drop constraint if exists fotos_perfiles_etiquetas_normalizadas;
alter table public.fotos_perfiles drop constraint if exists fotos_perfiles_tipo_proveedor_check;
alter table public.fotos_perfiles
  drop column if exists tipo_proveedor,
  drop column if exists pais,
  drop column if exists estrellas,
  drop column if exists web,
  drop column if exists contacto_nombre,
  drop column if exists celular,
  drop column if exists celular_original,
  drop column if exists correo,
  drop column if exists telefono,
  drop column if exists direccion,
  drop column if exists notas,
  drop column if exists etiquetas,
  drop column if exists tarifas_mayorista,
  drop column if exists responsable_tarifas_id,
  drop column if exists origen,
  drop column if exists origen_ref,
  drop column if exists comprado_via_id,
  drop column if exists updated_by;

alter table public.fotos_perfiles drop constraint fotos_perfiles_tipo_check;
alter table public.fotos_perfiles add constraint fotos_perfiles_tipo_check check (tipo in ('hotel', 'actividad'));

comment on table public.fotos_perfiles is
  'Hoteles y tours del espacio con fotos en la biblioteca (fotos_catalogo, por la misma clave). Los crea ONE cuando aparecen en una cotización; las fotos del perfil entran solas en la propuesta.';

update storage.buckets
   set allowed_mime_types = array['image/jpeg'], file_size_limit = 5000000
 where id = 'fotos-catalogo';
