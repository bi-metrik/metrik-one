---
name: releer-lectura-fallida-huecos
description: "SOE-029 (#1283, 26-oct): «Leer de nuevo» en modo visible = reprocesarDocumento con soloHuecos; los bloques del Gemini 403 (1–13 oct) no tenían salida en pantalla"
metadata:
  type: project
---

PR **#1283**, rama `fix/soe029-releer-lectura-fallida`. Sin migración. `reprocesarDocumento(b, n, { soloHuecos: true })`
llena solo los slugs ausentes (`completarCampos`), no baja el estado ni re-sella `completado_at`, y sin huecos ni
llama al modelo. El banner «Leer de nuevo» aparece en modo VISIBLE si falló la lectura, hay archivo, faltan campos y
`puedeCorregirVisible`.

**Why:** 22 bloques con `Error de Gemini (403)` entre 1 y 13-oct (3 comprobantes UPME bloquean el RC-3). En modo
visible no había Reintentar y `Object.keys(campos).length > 0` escondía los campos vacíos: ni releer ni escribir a mano.
Causa del 403 (deducción): facturación del proyecto de Google cortada («Lightning dunning decision is deny», visto
10/11-oct en la llave de pruebas y anotado también para prod en [[tanda-bot-1012]]). En código no cambió nada el 13-oct.

**How to apply:**
- ⚠️ `aplicarNormalizaciones` MUTA los campos en sitio y `completarCampos` copia solo el mapa: sin `structuredClone`
  el NIT ya guardado salía recortado. Cualquier merge nuevo antes de normalizar necesita copia profunda.
- La «corrección» de una etapa superada solo la pinta el modo visible; el reproceso completo vive solo en editable.
- Reproceso no re-dispara el aviso al cliente: `trg_avisar_documento_cargado` exige que `drive_url` NAZCA en el update.
- Cruces de línea callan si falta un lado (salvo `requeridos`): un documento sin campos es un falso verde en titularidad.

Relacionado: [[rc3-desde-comprobante-upme]].
