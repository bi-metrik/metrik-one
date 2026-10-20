---
name: tarifas-en-cotizacion
description: Trappvel 2026-10-19 (feat/trappvel-tarifas-en-cotizacion) — tarifas extraídas ofrecidas en la línea y elegidas por la persona; items.proveedor_id con migración 20261019233000 SIN aplicar; elección = casilla 1 origen 'tarifario' + tarifa_pax.tarifaExtraida
metadata:
  type: project
---

Sigue a [[motor-v13]]. Decisión de Mauricio: ONE ofrece, la persona elige; nunca elige solo.

- **Migración `20261019233000_items_proveedor.sql` SIN aplicar al abrir el PR** (dry-run y reversa en
  `sql/proveedores/2026-10-19_*items-proveedor.sql`). Trigger de mismo espacio (items no tiene workspace_id). El código
  tolera su ausencia: lee items con `select('*')`, `fijarProveedorDeLinea` dice «falta la migración», y el autollenado
  de `iva-costos-actions.ts` solo escribe si la fila trae la columna.
- **La elección NO es un camino de costo nuevo**: escribe la casilla 1 (`origen: 'tarifario'`) y llama
  `confirmarTarifaPorPasajero` (rubros, margen del proveedor con comisión vía `aPagarAgencia`, tasa si no es COP).
  El origen va en `tarifa_pax.tarifaExtraida` y vale mientras `leidaEn` coincida con la casilla 1 (`origenVigente`).
  Llave nueva de `tarifa_pax` ⇒ leída en `leerTarifaPax` o se pierde en la próxima escritura.
- Tarifa por habitación/grupo se reparte por cabeza solo para la tabla (infante 0); opciones con habitaciones R8 se
  rechazan. Para cotizar cuenta la ÚLTIMA `revisada` (`extraccion-para-cotizar.ts`), no la última corrida.
- El doble compartido `test/cotizacion-pdf-doble.ts` ahora proyecta `cotizaciones(` en `items` y tiene `ilike`.
- Sin construir: TRM, suplementos/descuentos/noches mínimas/días de semana del tarifario, filtro por `fecha_salida`.

**How to apply:** aplicar la migración antes del merge; para tocar el cálculo, `oferta-tarifas.ts` y sus pruebas
(L60 incluidas). Medición: `sql/proveedores/2026-10-19_medir-origen-precio.sql`.
