---
name: pantallazo-ranuras
description: PR #700 mergeado — RX1 solo se probó contra capturas SINTÉTICAS; el desglose del modelo no es estable entre corridas y por eso gana el total; y por qué la propuesta no se persiste
metadata:
  type: project
---

**PR [#700](https://github.com/bi-metrik/metrik-one/pull/700) mergeado el 2026-09-14**
(squash `a7c826c3`), 6 checks verdes, **sin migración y sin una escritura a
producción**. Paso 3 de los 7 del motor de cotización de Trappvel
(`proyectos/trappvel/clarity/docs/diseno/motor-cotizacion.md`, §3). Antes: paso 1
[[margen-visible-trappvel]] (#682) y paso 2 [[itinerarios-cotizacion]] (#684).

**Why:** una agencia pega el pantallazo del proveedor para costear. Si el sistema lee
un LISTADO y elige una fila, sale un precio plausible, con la aerolínea correcta, por
el número equivocado — y eso no falla en ninguna parte.

## ⚠️⚠️ RX1 está probado contra capturas que YO construí, no contra proveedores reales

**No existe banco de pantallazos reales.** Lo único en `proyectos/trappvel/` es el
comprobante de un anticipo bancario. Las 4 capturas de la evaluación son HTML que
rendericé con chromium para el PR. El propio diseño lo declara abierto en §10 (*«A7 ·
10 solicitudes reales con su cotización resultante | Edgar»*).

Que el modelo rechace mi listado **no prueba** que rechace el buscador real de
Despegar, que trae filtros, publicidad, carruseles y una tarifa resaltada. Es lo
primero que hay que correr con una captura real antes de citar el indicador de §8
(«capturas rechazadas por RX1»).

**How to apply:** si alguien pregunta «¿el rechazo funciona?», la respuesta honesta es
«contra capturas sintéticas sí, 4 de 4; contra proveedores reales no se ha probado».

## ⚠️⚠️ El desglose del modelo NO es estable; el total sí

Medido sobre la **misma imagen**, tres corridas. La fila «Tarifa aérea (2 adultos) COP
1.860.000» volvió como `2 × 930.000` (suma exacta) y como `2 × 1.860.000` (suma
4.260.000 contra un total de 2.400.000, **78% de más**). El modelo no distingue de
forma estable si el número de una fila es unitario o de línea.

El **total**, en cambio, salió idéntico y con confianza 1 en las tres corridas.

Por eso `desgloseReconcilia` (`src/lib/cotizaciones/lectura-pantallazo.ts`): cuando no
cuadran con 1% de tolerancia, **el desglose se descarta y gana el total**, diciéndolo.
Avisar y proponer igual sería apostar a que alguien lea el aviso, y quien confirma está
confirmando, no recalculando.

## Cuatro trampas más del modelo vivo, ya cerradas

| Qué pasó | Dónde se cerró |
|---|---|
| El `responseSchema` declara `value` como STRING → el modelo **no puede devolver JSON null** y devuelve la cadena `"null"`. Volvieron los 15 campos así | `textoOVacio` en `extraer-ranura.ts` (también `none`, `n/a`) |
| `MAX_TOKENS` con el límite en 8.192, **dos intentos seguidos**, sobre una captura impecable. El pensamiento no es determinista | presupuesto a 24.576 |
| Una corrida se pasó de **90 s**; la misma imagen aislada tardó 7,7 | `AbortSignal.timeout(25_000)` por intento |
| El modelo escribió **un párrafo entero** dentro de `unidad`, y eso entra a `rubros.unidad` y se imprime | `soloLaCabeza` + `recortar` |

⚠️ La primera trampa **también existe en `extract-fields.ts`** (el extractor de
documentos), que hace `String(f.value)` sin filtrar. No se tocó: fuera del encargo.

## R-P1: la propuesta NO se persiste, y es deliberado

El diseño dice «crea rubros en estado sugerido». `rubros` **no tiene esa columna** y
agregarla no basta: `calcularCascada` suma TODOS los rubros, así que un sugerido
entraría al costo como confirmado — justo lo que R-P1 prohíbe. Se sostiene en pantalla.

**Lo que se pierde:** recargar la página descarta la propuesta y hay que volver a pegar.
Eso cuesta una captura; lo otro cuesta el margen del viaje.

## ⚠️ `rubros.tipo` tiene CHECK de SEIS valores

`mo_propia`, `mo_terceros`, `materiales`, `viaticos`, `software`, `servicios_prof`.
Escribir `'tarifa'` lo rechaza la base con **23514**. El concepto del diseño vive en
`rubros.descripcion` y el tipo queda en `servicios_prof`.

DDL listo y **sin aplicar** en
`proyectos/trappvel/clarity/migrations/2026-09-14_pantallazo-ddl-pendiente.sql`.
⚠️ Dos avisos que van con él: `comision_proveedor` (§6.3) es **ingreso** y la cascada
suma todo como costo; y `rubros.sugerido` **no se puede aplicar sola**.

## Los dos defectos de 3a eran de PANTALLA, no de servidor

- El nombre del ítem no tenía input en ninguna parte (medido: cero `<input>` con él).
  `updateItem` **ya aceptaba `nombre`** desde antes.
- El grupo era texto libre con un `datalist` armado con los grupos ya usados en ESA
  cotización: en una nueva salía con **0 `<option>`**. `actualizarRanuraDeItem` ya
  escribía bien.

**How to apply:** ante un «no me deja X», medir primero si la acción del servidor
existe y funciona. Las dos veces el servidor estaba bien y la pantalla no ofrecía por
dónde — una prueba de los helpers habría seguido en verde con la pantalla rota.

## Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Registro de ranuras (contrato, campos, sinónimos) | `src/lib/cotizaciones/ranuras-pantallazo.ts` |
| Rechazo RX1–RX5 y conversión a rubros (puro) | `src/lib/cotizaciones/lectura-pantallazo.ts` |
| Prompt + llamada a Gemini + RX6 | `src/lib/ai/extraer-ranura.ts` |
| Política de reintento, compartida con documentos | `src/lib/ai/reintentar-extraccion.ts` |
| Server actions (leer / confirmar) | `src/app/(app)/negocios/pantallazo-actions.ts` |
| Pantalla del cargue | `src/app/(app)/negocios/pantallazo-item.tsx` |
| Selector de grupo | `src/app/(app)/negocios/selector-ranura.tsx` |

La ranura **se deriva de `items.grupo`**, nunca se elige aparte: un segundo desplegable
sería una segunda fuente para la misma pregunta. Un ítem sin grupo no ofrece cargue, y
eso es el contrato, no una limitación.

Relacionado: [[itinerarios-cotizacion]], [[margen-visible-trappvel]],
[[qa-pantalla-viva-cdp]], [[pruebas-por-mutacion]], [[cifras-del-brief-caducan]].
