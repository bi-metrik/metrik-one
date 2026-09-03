---
name: sheetjs-fechas-excel
description: Cómo escribir fechas e hipervínculos con xlsx 0.18.5 (SheetJS) para que Excel las lea como fecha en el día correcto — medido en UTC y en Bogotá el 2026-09-03
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
- `cellDates: true` va en las DOS llamadas: en `XLSX.utils.json_to_sheet(filas, {cellDates:
  true})` para que el `Date` sea celda `t:'d'` y no texto, y en `XLSX.write(wb, {cellDates:
  true})` para que se escriba como fecha exacta. Sin el segundo, el serial se redondea y
  la celda vuelve con **un milisegundo menos** (`21:29:59.999`).
- Formato: SheetJS deja `m/d/yy` por defecto; se cambia poniendo `celda.z = 'yyyy-mm-dd'`
  (o `'yyyy-mm-dd hh:mm'`) después de armar la hoja, celda por celda.
- **Hipervínculo:** `ws[ref].l = { Target: url, Tooltip: '…' }` sobrevive al write/read.
- `null` en una fila de `json_to_sheet` **no crea celda** (queda vacía), que es lo que se
  quiere para «no se sabe»; `0` sí crea celda.
- Una prueba que muta `new Date(y, m-1, d)` por `new Date(str)` **solo cae fuera de UTC**:
  CI (UTC) no la ve. Por eso la aserción compara componentes locales y el docblock de la
  prueba lo deja escrito.

Usado por: la descarga de negocios ([[descarga-excel-negocios]]). El precedente
`src/app/api/revision/export/route.ts` escribe las fechas como texto, no como fecha.
