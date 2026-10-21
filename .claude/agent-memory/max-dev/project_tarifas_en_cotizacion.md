---
name: tarifas-en-cotizacion
description: Trappvel 2026-10-19/21 (#1215, #1224, #1227 mergeados; feat/cotizar-con-tarifa) — tarifas extraídas en la cotización; línea nueva con tarifa entra por la aceptación de la bandeja; citable = revisada; reconocer asocia un candidato sin preguntar
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

**Pulido (brief del 2026-10-21, feat/panel-tarifas-pulido, sin migración):**
- Modo cambiar (`costoActual > 0`): la fila de hoy NO se pre-marca, se señala «La que usas hoy». Pre-marcada, elegir
  otra la sumaba y `calcularEleccion` rechazaba por pax de más. Sin costo confirmado sí se pre-marca (reintento con tasa).
- La fuente de la casilla 1 (`fuenteDeLectura`: pantallazo/manual/tarifario) decide TODO texto de origen. Los mensajes
  de `resolverTarifa` se reescriben en un envoltorio (`conFuenteDeLaCasilla1`), no rama por rama: hay ~15 cadenas con
  «pantallazo». Una cadena nueva que empiece por «Este pantallazo» / «Pantallazo 1» queda cubierta; otra forma, no.
- La lectura del tarifario trae `ocupacionDelItem: true` ⇒ «ocupación no visible en la imagen» si no se mira la fuente.
- «Montarse sobre la lista» no era solapamiento CSS: la lista con scroll iba pegada al texto, sin marco ni aire, y al
  desplazarse las tarifas se cortaban justo bajo él. Se vio en Chromium con `scrollTop` puesto por script.


**Cotizar con tarifa (brief del 2026-10-21, feat/cotizar-con-tarifa, sin migración):**
- Línea nueva: `crearLineaConTarifa` firma la lectura del tarifario y reusa `aceptarCapturaDeBandeja`/`aceptarPorPasos`
  (decisión `opcion`); después escribe `proveedor_id` + `tarifaExtraida` (`camino`, `segundos`). No crear ítems a mano.
- `costoPendiente`/«Todavía no tengo el costo» quedó solo de lectura (la UI y el servidor ya no lo crean).
- Preselección: nunca comparar precios entre monedas (pasó: USD 210 «ganaba» a COP 300.000).
- `reconocer`: duda con UN candidato en la misma ciudad = `seguro porDuda`; lo creado a propósito pasa `preguntarDudas`.
  «No es este» = `fichaDescartada` por línea (el alias global se borra pero `seguro` lo recrearía).
- Capturas: arnés happy-dom → innerHTML + CSS de `@tailwindcss/postcss` → chromium CDP (receta en
  [[build-en-worktree]] no aplica; ver bitácora 2026-10-21).
