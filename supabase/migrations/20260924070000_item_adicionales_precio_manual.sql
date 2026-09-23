-- P4 del ensayo del 2026-09-23 (Trappvel, caso Providencia): el precio del adicional sale
-- del margen global de la cotización, y el asesor lo puede cambiar después.
--
-- Hace falta saber CUÁL precio escribió una persona: cuando cambia el margen global, los
-- adicionales sin precio a mano se recalculan y los escritos a mano no se tocan. La tabla
-- no tenía dónde decirlo.
--
-- DDL puro y aditivo. `default true`: toda fila existente se tomó con su precio escrito a
-- mano (la pantalla lo pedía), así que sigue mandando lo guardado y ningún precio se mueve.
-- Medido el 2026-09-23 en producción: 1 fila, con precio 90.000 escrito a mano.
--
-- El código tolera la columna ausente: sin ella escribe el precio calculado como número
-- (se pierde que se recalcula con el margen, no el precio) y lee todo como «a mano».

alter table public.item_adicionales
  add column if not exists precio_manual boolean not null default true;

comment on column public.item_adicionales.precio_manual is
  'true = el precio lo escribio una persona y manda. false = sale del margen global de la cotizacion (costo / (1 - margen)) y recalcularTotales lo reescribe cuando cambia el margen o el costo.';
