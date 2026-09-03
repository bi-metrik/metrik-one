-- ============================================================
-- Cotizar por rubros: el ítem deja de quedar en cero
-- ============================================================
--
-- QUÉ ARREGLA
-- `rubros.valor_total` es GENERATED (cantidad * valor_unitario) y los rubros suman
-- bien, pero `recalcularTotales` escribía esa suma únicamente en `items.subtotal`
-- (COSTO). La fila del ítem, el total de la cotización y el PDF muestran
-- `items.precio_venta`, que nadie derivaba de los rubros: por eso el ítem cotizado
-- por rubros queda en cero.
--
-- Con estas dos columnas, `recalcularTotales` puede derivar
--   precio_venta = round(subtotal * (1 + margen_porcentaje / 100))
-- para todo ítem NO ajuste, con al menos un rubro y `precio_manual = false`.
-- Un ítem sin rubros o con `precio_manual = true` se comporta EXACTAMENTE como hoy.
--
-- ⚠️ ESTA MIGRACIÓN NO ESTÁ APLICADA. Leer el bloque de backfill de abajo ANTES
--    de aplicarla: aplicar el schema sin el backfill deja 11 ítems expuestos a
--    perder su precio manual.
--
-- Medido contra producción el 2026-09-03 (solo lectura), 37 ítems en toda la base:
--   · 16 ítems con al menos un rubro
--   ·  2 de ellos con precio_venta = 0  ← el defecto, $4.096.500 de costo atrapado
--        (metrik COT-2026-0005 "Clarity Express" y wmc-sm COT-2026-0004 "MATERIALES
--         POLIPROPILENO"; los dos en borrador)
--   · 11 con precio_venta manual distinto del costo de sus rubros
--   ·  3 cuyo precio ya coincide con el costo (delta 0)
--   · termotech tiene 12 ítems y NINGUNO usa rubros todavía: para ese workspace
--     esto es preventivo, no correctivo.
-- ============================================================

alter table items
  add column if not exists margen_porcentaje numeric not null default 0,
  add column if not exists precio_manual boolean not null default false;

comment on column items.margen_porcentaje is
  'Margen % sobre el costo de rubros. Solo se aplica cuando precio_manual = false y el ítem tiene rubros.';
comment on column items.precio_manual is
  'true = el precio de venta lo escribió una persona y el sistema no lo recalcula desde los rubros.';

-- Términos y condiciones al pie de la cotización (dato; el diseño del PDF
-- se ajusta en un encargo aparte).
alter table cotizaciones
  add column if not exists terminos_condiciones text;

comment on column cotizaciones.terminos_condiciones is
  'Términos y condiciones que van al final de la cotización. Texto libre multilínea.';


-- ============================================================
-- BACKFILL — REQUIERE APROBACIÓN DE MAURICIO ANTES DE APLICAR
-- ============================================================
--
-- POR QUÉ HACE FALTA
-- `precio_manual` nace en `false` para TODAS las filas existentes. Con
-- `margen_porcentaje` también en 0, la primera vez que alguien dispare
-- `recalcularTotales` sobre una cotización con ítems ya cotizados, el precio de
-- venta que una persona escribió se reemplaza por el costo pelado de sus rubros.
--
-- ALCANCE MEDIDO (2026-09-03, producción, solo lectura):
--   · 11 ítems perderían su precio. Diferencia acumulada: $7.173.361.
--   · De esos 11, 2 están en cotizaciones en BORRADOR y son alcanzables HOY desde
--     el editor ($862.493): metrik COT-2026-0009 "Diagnóstico Mediana" (-$829.000)
--     y wmc-sm COT-2026-0003 "BARANDA TELESCOPICA" (-$33.493).
--   · Los otros 9 están en cotizaciones aceptada/enviada/rechazada. `recalcularTotales`
--     solo se invoca desde el editor y el editor exige estado borrador (`isEditable`),
--     así que hoy no son alcanzables — PERO `duplicarCotizacion` copia los ítems a un
--     borrador nuevo, y ahí sí. Los peores: metrik COT-2026-0006 y COT-2026-0001,
--     ítem "DataBook", $2.000.000 → $100.000 (-$1.900.000 cada uno).
--
-- QUÉ HACE
-- Marca como precio manual todo ítem que hoy tiene un precio de venta puesto, para
-- no alterar precios de cotizaciones ya enviadas o aceptadas. Los 2 ítems del defecto
-- (precio_venta = 0) quedan fuera y son justo los que el fix va a recalcular.
-- Alcanza a 28 ítems (los 11 en riesgo + 14 con rubros ya alineados o sin diferencia
-- + los de termotech, que no tienen rubros y para los que la marca es inocua).
--
-- CÓMO SE VUELVE ATRÁS
--   update items set precio_manual = false;   -- devuelve todo al estado por defecto
--
-- update items
--    set precio_manual = true
--  where precio_venta is not null
--    and precio_venta > 0
--    and not es_ajuste;
--
-- -- Verificación (sentencia aparte, después del update):
-- --   select count(*) filter (where precio_manual)      as marcados,
-- --          count(*) filter (where not precio_manual)  as libres
-- --     from items where not es_ajuste;
-- --   Esperado el 2026-09-03: marcados = 28, libres = 3.
-- ============================================================
