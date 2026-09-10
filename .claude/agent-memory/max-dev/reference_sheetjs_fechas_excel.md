---
name: sheetjs-fechas-excel
description: Cómo escribir fechas e hipervínculos con xlsx 0.18.5 (SheetJS) para que las lean Excel, Google Sheets y LibreOffice — `cellDates` SOLO en `json_to_sheet`, nunca en `write`
metadata:
  type: reference
---

Medido el 2026-09-03 con `xlsx@0.18.5` corriendo el mismo script bajo `TZ=UTC` y
`TZ=America/Bogota` (escribir un libro y releerlo):

- **SheetJS convierte un `Date` a serial de Excel con los getters LOCALES del runtime**
  (`datenum` usa `getTimezoneOffset`). Un `Date` construido con el instante real
  (`new Date(iso)`) sale con un día distinto según dónde corra el servidor: Vercel (UTC)
  muestra el día UTC; un portátil en Bogotá, el día local. **Construir el `Date` con la
  hora de pared que se quiere ver, en componentes locales**: `new Date(y, m-1, d, hh, mm)`
  con las partes de `bogotaParts()`. Un `'YYYY-MM-DD'` NUNCA pasa por `new Date(str)`
  (lo lee como UTC y en Colombia lo corre un día atrás). Implementado en
  `fechaExcel` de `src/lib/negocios/export-excel.ts`.
- ⚠️⚠️ **`cellDates: true` va SOLO en `json_to_sheet`, NUNCA en `XLSX.write`.** Esta linea
  decia lo contrario («va en las DOS llamadas») y ese consejo es el que produjo el defecto:
  en `write`, `cellDates` escribe la celda con el tipo ISO-8601 del OOXML
  (`<c t="d"><v>2026-01-15T00:00:00.000Z</v></c>`), que Excel soporta y que **el importador
  de Google Sheets DESCARTA en silencio** — el archivo abre bien y las columnas de fecha
  salen VACIAS. Sin `cellDates` en el write sale serial numerico (`<v>46037</v>`) mas el
  formato `z`, y eso lo leen los tres. Corregido el 2026-09-10 (PR #623).
  - **La razon por la que se puso (el redondeo) esta medida y es despreciable**: barriendo
    los 1000 ms de un minuto con `xlsx@0.18.5`, la peor desviacion del serial es de **1 ms**,
    contra los **60.000 ms** de resolucion de `yyyy-mm-dd hh:mm`. Y el `21:29:59.999` que
    citaba esta memoria no se reproduce: releyendo el buffer, las dos formas devuelven el
    instante exacto.
  - ⚠️ **El round-trip con SheetJS NO distingue las dos formas**, asi que una prueba que
    escriba y relea pasa con el defecto puesto. Hay que **mirar el XML**: descomprimir el
    `.xlsx` (`pizzip` ya es dependencia directa del repo) y afirmar que no aparece `t="d"`.
    Medido: con el defecto, 6 celdas con `t="d"`; sin el, 0.
- Formato: SheetJS deja `m/d/yy` por defecto; se cambia poniendo `celda.z = 'yyyy-mm-dd'`
  (o `'yyyy-mm-dd hh:mm'`) después de armar la hoja, celda por celda.
- **Hipervínculo:** `ws[ref].l = { Target: url, Tooltip: '…' }` sobrevive al write/read.
- `null` en una fila de `json_to_sheet` **no crea celda** (queda vacía), que es lo que se
  quiere para «no se sabe»; `0` sí crea celda.
- Una prueba que muta `new Date(y, m-1, d)` por `new Date(str)` **solo cae fuera de UTC**:
  CI (UTC) no la ve. Por eso la aserción compara componentes locales y el docblock de la
  prueba lo deja escrito.
- **Donde vive el armado del libro:** `src/lib/negocios/export-excel-libro.ts` (filas ->
  buffer). Se extrajo del route a proposito: el defecto no se ve en las filas —siempre
  trajeron `Date`— solo en el XML del `write`, asi que una prueba que reconstruya el libro
  por su cuenta no tumba una regresion del route. `export-excel.ts` sigue puro y sin
  conocer XLSX, como declara su encabezado.
- ⚠️ `XLSX.write` esta declarado `any`: el tipo de retorno lo **afirma** quien llama. Con
  `type: 'buffer'` el que compila contra `NextResponse` es `Buffer<ArrayBuffer>`; `Buffer`
  a secas y `Uint8Array` los rechaza `BodyInit` por el generico de @types/node.

- ⚠️⚠️ **`cellDates` en `json_to_sheet` NO arregla nada si las filas traen TEXTO.** Medido
  el 2026-09-10 (PR #627): con las filas como string, el XML sale **identico** con y sin la
  opcion (`<c t="str"><v>2026-09-01</v></c>` en los dos casos). Lo que convierte la celda
  es el **`Date`**; la opcion solo decide como se guarda ese `Date`. O sea que copiar el
  patron de negocios a otra ruta **no basta**: alli `armarFilasExcel` ya devolvia `Date`.
  Primero se parsea con `fechaExcel`, y recien entonces la opcion sirve de algo.
- **Una fila con `null` no deja celda en el XML**, aunque se le asigne `z`: `json_to_sheet`
  crea un hueco (`t:'z'`, `v:null`) y el `write` no lo emite. Asi que una fecha ausente
  queda como celda vacia sin necesidad de saltarla en el bucle de formatos — probado
  quitando la guarda, ninguna prueba cambio. **La garantia la da la prueba, no la guarda.**
- **Con `header` explicito, una lista VACIA deja la fila de encabezados**; sin el, la hoja
  sale completamente en blanco. Es un cambio de comportamiento a tener en cuenta al migrar
  una hoja que hoy no declara sus columnas.

**Como se verifica que no se movio nada mas:** reconstruir el libro con la implementacion
VIEJA (copiando las 4 lineas del route de `origin/main` dentro de un script) y comparar el
XML hoja por hoja contra el nuevo, sobre las mismas filas. En el #627 salio: `Resumen`
identico byte a byte, y en `Cobros`/`Gastos` cambian **solo** las celdas de fecha. Es la
unica forma barata de probar que no se corrio ninguna columna.

Usado por: la descarga de negocios ([[descarga-excel-negocios]]) y el export de
`/revision` (PR #627, `src/lib/revision/export-excel-libro.ts`), que eran los **dos**
unicos export xlsx del repo. Barridos los 12 `XLSX.write`, ninguno mas tenia `cellDates`
en el write.
