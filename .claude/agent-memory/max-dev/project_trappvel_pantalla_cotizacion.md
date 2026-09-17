---
name: trappvel-pantalla-cotizacion
description: "#777 mergeado: limpieza de la pantalla de cotización de viaje (Unidad, catálogo, AIU), el aviso donde iría la tabla de combinaciones, y los textos que se guardan en MAYÚSCULA — con el gate medido"
metadata:
  type: project
---

**PR [#777](https://github.com/bi-metrik/metrik-one/pull/777) mergeado el 2026-09-17**, checks
verdes, **sin migración y sin una sola escritura a producción**. Sigue a [[tarifa-por-pasajero]]
(#763) y a las líneas por tipo (#776).

**Why:** Mauricio puso a cotizar al equipo de Trappvel ese día y la pantalla tenía campos que
nadie usa, un control que el propio flujo borra un minuto después, y una sección que
desaparecía sin decir por qué.

## ⚠️⚠️ El gate, MEDIDO: un solo bloque en toda la base

Todo cuelga de `lineasPorTipo` / `bloqueDeclaraComposicionViaje`. Medido el 2026-09-17 contra
producción por PostgREST (`config_extra->>fields=ilike.*adultos*` y `*infantes*`): **el ÚNICO
`bloque_configs` de toda la base que declara `adultos`/`ninos`/`infantes` es
`condiciones_del_viaje` de la línea «Viaje a medida» de Trappvel** (`cdd87e5d-…`). Por eso el
criterio de «esto es un flujo de viaje» se puede usar sin miedo: no hay segundo cliente.

**How to apply:** antes de ampliar cualquier cosa a «el flujo de viaje», re-medir esa consulta.
El día que un segundo workspace declare esos campos, hereda TODO esto de golpe.

## Lo que se quitó, y por qué cada cosa

| Qué | Razón (medida) |
|---|---|
| Campo **«Unidad»** de la línea | La escribe la ranura al leer el pantallazo (`ranura.unidadPorDefecto`) y **`confirmarTarifaPax` la deja en `null` a propósito** (`tarifa-pax-actions.ts`). Se tecleaba un dato que el flujo borra. |
| **«Desde catálogo»** | El workspace de Trappvel tiene **0 `servicios`**. El botón solo abría un panel vacío, en el renglón de «+ Vuelo / + Hotel». |
| Invitación **«+ Administración e imprevistos»** | AIU es convención de obra pública: segundo recargo sobre el mismo costo, al lado del margen general. **0 de 6** cotizaciones de Trappvel lo usan. ⚠️ Solo se quitó la INVITACIÓN (`ofrecerAdministrativos`): una cotización con valores los sigue mostrando y editando. |

## ⚠️ Combinaciones: NO había defecto, había silencio

`TablaCombinaciones` devolvía `null` cuando `ranuras.length === 0 && itinerarios.length === 0`.
`ranuras` es `ranurasCombinables` = grupo **vuelo u hotel** con MÁS DE UN candidato. Medido en
el negocio de prueba `5ad5a055-d639-4042-b30a-ecf1519384ca`:

- **COT-2026-0002** — un `vuelo`, un `hotel` y una tercera línea (`PRUEBA Hotel Cancun`) **con
  `grupo` en `null`**. Cero ranuras → la sección no existía.
- **COT-2026-0001** — dos líneas en `vuelo` → la tabla **sí** aparece.
- `cotizacion_itinerarios` existe (no es la migración) y está vacía en las tres.

Arreglo: `explicarVacio` (opt-in) pinta una línea donde iría la tabla con **las dos** salidas —
«Agregar alternativa a esta línea» **y** darle a dos líneas sueltas el **mismo grupo**, que es lo
que le faltaba al segundo hotel del caso real.

## Mayúsculas: una función pura, dos lados

`src/lib/negocios/mayusculas.ts` — `aMayusculas` y `mayusculasDeBloqueDeViaje`.

- **Se GUARDA**, no se maquilla: nombre y descripción de línea (a mano, el provisional de «+
  Vuelo» y el que trae el pantallazo al confirmar), nombre de la cotización, y el texto libre del
  bloque «Condiciones del viaje» (`actualizarBloqueData` **y** `marcarBloqueCompleto`).
- **Tildes y Ñ intactas**: `toLocaleUpperCase('es-CO')` («Bogotá» → «BOGOTÁ»).
- **No se tocan** correos (la guarda del `@` vive en la primitiva, para que pantalla y servidor no
  discrepen), números, fechas, selectores ni términos y condiciones.
- **No se convierte lo ya guardado**: un nombre propio escrito antes sigue igual, y confirmar el
  pantallazo tampoco lo pisa (`nombreAlConfirmarLectura` ya lo impedía).
- En el editor la casilla **repinta lo guardado** (`e.target.value = val`): con `defaultValue`, sin
  eso el campo queda con lo tecleado y la base con otra cosa.

⚠️ **Hueco declarado:** la conversión MIENTRAS SE ESCRIBE en «Condiciones del viaje» no la mide
ninguna prueba — `renderToStaticMarkup` corre sin DOM ni eventos. Lo probado es la función pura y
la barrera del servidor.

⚠️ `confirmarLecturaDePantallazo` (`pantallazo-actions.ts`) **no se tocó**: es el cargue de un
solo total y **no tiene un consumidor `.tsx` desde el #763**. Si se revive, le falta la mayúscula.

Relacionado: [[tarifa-por-pasajero]], [[pantallazo-ranuras]], [[itinerarios-cotizacion]],
[[trappvel-reglas-reunion-15]], [[pruebas-por-mutacion]].
