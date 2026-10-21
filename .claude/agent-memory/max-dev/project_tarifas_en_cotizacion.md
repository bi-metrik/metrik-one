---
name: tarifas-en-cotizacion
description: Trappvel 2026-10-19/20 (#1215 mergeado; alcance en feat/panel-tarifas-alcance) — tarifas extraídas ofrecidas en la línea y elegidas por la persona; items.proveedor_id ya en prod; elección = casilla 1 'tarifario' + confirmar de siempre; línea a mano = aMano (no es proveedor) y puede nacer costoPendiente
metadata:
  type: project
---

Sigue a [[motor-v13]]. Decisión de Mauricio: ONE ofrece, la persona elige; nunca elige solo.

- **Migración `20261019233000_items_proveedor.sql`**: aplicada (el brief del 2026-10-20 vio `items.proveedor_id` guardado en prod) (dry-run y reversa en
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

**Alcance (brief del 2026-10-20, feat/panel-tarifas-alcance, sin migración):**
- Con el costo confirmado el panel va en `cambiarCosto` de `TarjetaOpcion` (fuera de `respaldo`), con `costoActual`.
  Reemplazar en otra moneda exige la tasa en la pantalla: `resto` de `elegirTarifasDeLinea` conserva la `confirmada`
  vieja si la confirmación falla.
- `LecturaCasilla.costoPendiente` (a mano «sin costo», solo por pasos) ⇒ `resolverTarifa`/`resolverHabitaciones` dan
  `sin_costo`. `total` es 0: sin la marca se confirmaría en cero.
- `PedidoDeLinea.aMano`: sin crear perfil al pintar, sin ficha por nombre en panel, IVA ni aviso. Subir una foto
  (acción explícita) SÍ crea perfil todavía. Fichas creadas antes: `sql/proveedores/2026-10-20_fichas-creadas-solas.sql`.

