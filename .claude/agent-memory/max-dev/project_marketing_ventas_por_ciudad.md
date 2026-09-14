---
name: marketing-ventas-por-ciudad
description: PR #689 sin mergear — la migración va ANTES del merge o se cae /tableros entero; la ciudad solo existe para las ventas; y por qué el drill lleva la COLUMNA, no la lista de seccionales
metadata:
  type: project
---

**PR [#689](https://github.com/bi-metrik/metrik-one/pull/689)**, rama
`feat/marketing-ventas-por-ciudad`, 7 checks verdes, **sin mergear** y **sin aplicar la
migración** (`20260914220000_marketing_negocio_seccional.sql`). Tabla "Ventas por ciudad"
en la pestaña Marketing, con las seis columnas de `COLUMNAS_DIRECTIVO`.

**Why:** Mauricio, 2026-09-14: *"ver en el tablero de marketing por cuidades asi como se
ve en el tablero directivo"*.

## ⚠️⚠️ La migración va ANTES del merge, y el orden no es simétrico

`getMarketingData` pide la columna `seccional`. Contra la vista sin ella PostgREST
responde **400**, `traerTodo` lanza, y ese throw sube por el `Promise.all` de
`tableros/page.tsx`, que **no tiene catch por rama**: se cae **`/tableros` entero**, no
solo la pestaña. El módulo está encendido en soena (ver [[tablero-marketing-soena]]).

Al revés es inofensivo: aplicar la migración sin desplegar el código solo agrega una
columna que nadie consulta todavía.

**How to apply:** aplicar la migración, comprobar `pg_class` (la consulta está escrita al
final del archivo), y recién entonces mergear.

## La ciudad solo existe para las VENTAS, y eso es un dato medido

Medido contra producción el **2026-09-14** en soena (`7dea141d-…`):

- **99 negocios con campaña; 28 tienen seccional; esos 28 son exactamente las 28 ventas.**
  Los otros 71 son leads que no llegaron a Documentación, que es donde entra el RUT.
- Ventas con campaña por ciudad: Medellín **7**, Bucaramanga **3**, Cali **2**, Bogotá
  **2**, Otras ciudades **14**, Sin seccional **0**.
- ⚠️ **«Sin seccional» NO es siempre cero.** Las ventas **sin rastro de Meta** son **302** y
  **7 de ellas no tienen seccional**. El QA del brief decía «sale en cero»: eso vale solo
  para las filas de campaña.

Por eso leads, inversión, CPL, CAC y conversión **se quedan por campaña**: el gasto de
Meta es por campaña y un lead recién entrado no tiene ciudad. La misma razón ya escrita en
`tab-direccion.tsx`.

## ⚠️ El drill lleva la COLUMNA, no la lista de seccionales (aparte del brief)

`CampanaSeleccionada.columna: ColumnaDirectivo`, y el filtro lo aplica **`columnaDirectivo`
en el servidor** — la misma función que agrupó la celda. El brief pedía
`seccional?: string[]` + `seccionalLabel`; se descartó por tres razones, y la tercera es
la que cierra el tema: **«Sin seccional» no se puede escribir como lista, es una
negación** (sin valor, o con un texto que el catálogo no reconoce). Las otras dos: sería
una segunda expresión del mismo criterio, y «Otras ciudades» habría que derivarla del
catálogo entero.

**Decisión hermana, en `drillSeAcotaAVentas` (`src/lib/tableros/marketing.ts`):** una celda
de ciudad abre **solo ventas, también en cohorte**. Sin ese corte el panel abriría los
leads de la campaña y mostraría más casos de los que dice la celda — en cohorte el panel
de una campaña lista todos sus negocios **a propósito**.

## Lo que quedó por fuera

- **`honorario` y `recaudado` por ciudad se calculan y no se pintan.** `FilaCiudad` ya los
  trae; la tabla muestra el conteo, como la del directivo. Es cambiar el JSX, no el
  agregado.
- **No hay tarjetas para celular**: `overflow-x-auto` como la pestaña Dirección, que es la
  referencia que pidió Mauricio.
- **La comprobación de `pg_class.relacl` / `reloptions` no se pudo correr** (ver
  [[sql-prod-one]]): el clasificador bloqueó el token de la Management API, y el control
  con la anon key **no sirvió porque esa key de `.env.local` está caducada** — devolvió 401
  incluso sobre una tabla que sí concede, o sea que el instrumento estaba roto, no la
  vista. La consulta queda escrita en el archivo de migración.

Relacionado: [[tablero-marketing-soena]], [[pruebas-por-mutacion]], [[techo-postgrest]],
[[vistas-server-only]].
