---
name: drive-archivos-cobro
description: Etapa 1 del frente Drive «cualquiera con el enlace» (#768) — soporte de pago y recibo de caja nacen cerrados y se leen por /api/archivos/cobro; los 22 archivos VIEJOS siguen abiertos y la factura sigue naciendo pública a propósito
metadata:
  type: project
---

**#768 mergeado. Cierra SOLO los archivos NUEVOS de dos caminos; no tocó el permiso de
ninguno de los ~2.500 que ya están en Drive.**

**Why:** medido el 2026-09-16 con `curl` sin sesión, 22 de 22 archivos vivos de los
caminos que llaman `setFilePublicByLink` estaban abiertos a cualquiera con el enlace, sin
vencimiento, incluidas fotos de transferencias bancarias. El frente entero está en
`proyectos/metrik/one/2026-09-16_frente-drive-cualquiera-con-el-enlace.md`.

**How to apply:**

- **Lo cerrado:** `cobros.soporte` (`src/lib/cobros/soporte-pago.ts`) y
  `cobros.siigo_recibo` (`src/lib/siigo/recibos.ts`). El lector es
  `GET /api/archivos/cobro?cobro=<uuid>&doc=soporte|recibo`, que baja los bytes con la
  cuenta de servicio (`downloadDriveFile`), copiando a `send-cuenta-cobro.ts`. El criterio
  (qué archivo es, quién puede pedirlo, el href de la pantalla) vive PURO en
  `src/lib/almacenamiento/archivo-de-cobro.ts`; el servidor y el navegador lo comparten.

⚠️⚠️ **`archivarPdfEnBloque` lo comparte la FACTURA, y por eso el parámetro
`publicoConEnlace` tiene default `true`.** El brief atribuía ese archivo solo al recibo;
en realidad sus tres llamadores son recibo, factura emitida y factura cargada a mano, y
la factura SÍ llega a un cliente sin cuenta de Google. La etapa 2 es exactamente cambiar
ese default. Si algún día se apaga para todos sin resolver antes el lector de la factura,
el cliente recibe un enlace que no puede abrir.

⚠️⚠️ **Cerrar el recibo dejó al CLIENTE sin su documento, y nadie lo ajustó en el correo.**
Medido el 2026-09-21: **401 sin sesión** en los PDF de recibo, **200** en los de factura
(control). El copy seguía prometiendo la descarga: **14 avisos `enviado` a 8 clientes reales**
el 16 y el 17 de septiembre. Se cierra en el [[correo-recibo-dos-documentos]] (#804)
conservando una copia en Storage y firmándola 7 días, **sin reabrir el archivo de Drive**.
**How to apply:** al cerrar un archivo, barrer quién PROMETE ese archivo aguas abajo — el
correo al cliente no aparece en ninguna búsqueda del código de permisos.

⚠️ **Los 22 archivos viejos siguen abiertos y se abren igual por la ruta nueva.** La ruta
no depende del permiso: usa la credencial. Cerrarlos es la etapa 3 y es escritura masiva
contra la API de Drive; pide el sí de Mauricio aparte.

⚠️ **El id de Drive NUNCA llega del navegador.** Llega el id del COBRO y el archivo se
resuelve de esa fila ya filtrada por workspace. Un `fileId` del cliente convertiría la
ruta en un descargador genérico del Drive de MéTRIK. Vale para cualquier proxy de archivos
que se escriba después.

⚠️ **La puerta es workspace, NO negocio, a propósito.** Es el criterio que `abrir.ts` ya
documenta para el soporte de un pago: las pantallas que pintan esos enlaces filtran por
workspace y por rol, nunca por negocio, así que una puerta por negocio sería más estrecha
que la pantalla y dejaría filas con soporte inabrible. Ver [[referencia-archivos-one]].

**Dónde estaba el id, medido contra producción:** `cobros.soporte` YA guardaba
`drive_file_id` (8 de 8); `cobros.siigo_recibo` NO (7 marcas con solo `archivo_url`, forma
`https://drive.google.com/file/d/<id>/view?usp=drivesdk`). Ahora se guarda, y el parser
(`idDeArchivoDrive`, exige host de Drive) queda solo para esas 7.

**Tres pantallas pintaban el enlace crudo** y las tres cambiaron: el panel de pagos
externos, el control de recibos de Tesorería y el bloque de Cobros de la ficha — esta
última ni siquiera pasaba por `hrefArchivo`. Hizo falta una prueba de **render** por cada
una: la prueba pura del helper sigue verde con el JSX mandando a `drive.google.com`
([[pruebas-por-mutacion]]). Para poder pintarlas solas se exportaron `FilaPago`
(dos archivos distintos) y `ReciboDelPago`, como ya se hacía con `FilaPorFacturar`.

Los cuatro llamadores de etapa 2 quedan intactos: `push-documento-drive.ts`,
`documento-actions.ts`, `ve-documentos-negocio.ts`, `formulario-actions.ts`.
