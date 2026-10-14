-- ============================================================================
-- F1 · Seguimiento (post-cotización, PR 5): de dónde salió una versión nueva de la cotización.
--
-- Diseño técnico §8 y Vera F1-3: las versiones se cuentan desde la cadena `duplicada_de` sin
-- tecleo, y su origen (lo pidió el cliente, dirección, cambió el proveedor, venció la prerreserva)
-- se pide UNA vez al duplicar. La prerreserva vencida la escribe el sistema (C9, F2).
--
-- SOLO ESQUEMA: una columna nullable. Las cotizaciones que ya existen quedan en null (sin origen
-- conocido) y nada de lo de hoy la lee. Con `lineas_negocio.config_extra.seguimiento.activo`
-- apagado, nadie la escribe.
-- ============================================================================

alter table public.cotizaciones
  add column if not exists origen_version text
  check (origen_version in ('cliente', 'direccion', 'proveedor', 'prerreserva_vencida'));

comment on column public.cotizaciones.origen_version is
  'Por qué existe esta versión (copia por duplicada_de): cliente, direccion, proveedor o prerreserva_vencida. Null = original o sin dato.';
