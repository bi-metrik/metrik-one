-- Las reglas de margen de una cotización de viaje (Trappvel, 2026-10-27).
--
-- POR QUÉ. Mauricio y Edgar reemplazaron el 15 % plano sobre todo lo Neto por reglas por tipo de
-- servicio: colchón por tiquete en los vuelos, margen y descuento por hotel, 0 % en lo demás, puntos
-- extra sobre el total, descuentos sobre el total con descripción y un margen global con piso de
-- aprobación (`src/lib/cotizaciones/reglas-margen.ts`).
--
-- QUÉ CAMBIA. Solo DDL: una columna jsonb nullable en `cotizaciones`. Guarda:
--   · `politica`: los parámetros que la cotización COPIÓ de su línea al nacer (colchón nacional e
--     internacional, piso de hotel, tope de puntos extra). Se congelan como `convencion_margen` y
--     los umbrales: recalibrar la línea no le mueve el precio a una cotización ya enviada.
--   · `puntos_extra` y `descuentos`: lo que la asesora decide en la cotización.
-- NULL = sin reglas: la cotización se calcula exactamente como antes. Toda fila existente queda en
-- NULL (sin backfill) y solo nacen con reglas las cotizaciones de una línea que declare
-- `config_extra.margen.reglas`, que hoy no declara ninguna (el SQL de configuración de Trappvel va
-- aparte y sin aplicar: `sql/trappvel/2026-10-27_reglas-margen-PENDIENTE.sql`).
--
-- Sin grants nuevos: la columna hereda los de la tabla y su RLS por workspace.
--
-- ORDEN. Antes del merge, o en cualquier momento antes del SQL de configuración: el código lee la
-- fila con `*` (sin la columna llega `undefined` = sin reglas) y solo escribe la columna cuando la
-- línea declara reglas o la cotización ya las tiene.

alter table public.cotizaciones
  add column if not exists reglas_margen jsonb;

comment on column public.cotizaciones.reglas_margen is
  'Reglas de margen copiadas de la línea al nacer (politica) + puntos_extra y descuentos sobre el total. NULL = sin reglas (cascada de siempre). Ver src/lib/cotizaciones/reglas-margen.ts.';
