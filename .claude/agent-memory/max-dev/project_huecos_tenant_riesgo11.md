---
name: huecos-tenant-riesgo11
description: #752 y #754 cierran los huecos de tenant del riesgo 11 (antes de abrir ONE a 4D SOFT); siguen ABIERTOS data de bloques con claves libres (SSRF, Drive con credenciales globales) y Valida/ePayco con llave global sin gate de módulo
metadata:
  type: project
---

Dos PR, 2026-09-16, sin migración, motivados por dar acceso a ONE a un cliente externo (4D SOFT):
cualquier acción que acepte un id ajeno o no pida sesión es explotable por ese usuario.

**#752** (rama `fix/huecos-seguridad-riesgo11`, mergeado `4dc6b19e`): rutas AFI por workspace,
`crearV1Automatica` a `server-only` con guarda, `guardarDatosSarlaft`/`recalcularScoreNegocio` con
`negocioEsDelWorkspace`, muro público con los gates adentro de la función que lee.

**#754** (rama `fix/huecos-seguridad-riesgo11-ronda2`): `valida-consultas` valida el negocio antes
de llamar a Valida; `applyPlantilla(lineaId)` toma el workspace de la sesión (owner, plantilla
nativa, sin línea activa); `procesarDocumento`/`confirmarUploadDocumentoNegocio` exigen
`esRutaDeWorkspace` y el id viejo de Drive sale de la fila; `reprocesarDocumento` y
`procesarDocumentoNegocio` miran el workspace de la referencia `one://`; `centro-costos-asignar` y
los generadores AFI a `server-only`; sujetos/documentos de compliance validan sus referencias;
`consultarEpayco` y `listarConsultas` (valida.ts) exigen sesión.

**⚠️⚠️ Hallazgo del #754 que no se ve leyendo el código:** `storage-js` pega la ruta a la URL sin
codificar y el parser WHATWG de `fetch` normaliza `%2e%2e`, `.%2E`, `.<TAB>.` (tabs y saltos se
borran) y `\` como salto de carpeta. `one://ve-documentos/<mi_ws>/%2e%2e/<otro_ws>/…` pasaba la
puerta de `/api/archivos/abrir` (primer segmento = mi workspace) y se firmaba el archivo ajeno.
`remove` no es vulnerable (la ruta va en el cuerpo), `download`/`createSignedUrl` sí.

**Why:** toda lectura con service role a partir de un dato del navegador (o de `data`, que tiene
escritores con claves libres) es cross-tenant si no se compara contra la sesión en ese punto.

**How to apply:**
- Toda ruta de Storage que venga de afuera pasa por `esRutaDeWorkspace` o `parsearReferenciaOne`
  (`referencia.ts`), nunca por un `startsWith` propio. La copia de Deno tiene prueba de contrato.
- Antes de afirmar que un export es un hueco o que se cerró, mirar el manifiesto del build
  ([[manifiesto-server-actions]]). Pruebas: doble que aplica `.eq()` y registra efectos, vista
  fallar contra `origin/main` y guarda por guarda ([[pruebas-por-mutacion]]).
- ⚠️ ABIERTOS (archivo:línea en el cuerpo del #754): (1) `actualizarBloqueData` y
  `actualizarCamposNegocioBloque` aceptan claves libres en `data` → SSRF por `fetch(url)` en
  `procesarDocumentoNegocio`, y lectura/borrado de Drive ajeno con las credenciales globales;
  (2) `validarPersona`/`listarConsultas` y el respaldo `VALIDA_API_KEY` sin gate de módulo;
  (3) `consultarEpayco` sin gate `fab_pago_epayco`; (4) `cargarConfigPeriodicidad` sin sesión;
  (5) `updateLineaActiva` sin rol; (6) `notificar-etapa` sin redesplegar (guarda inerte).
