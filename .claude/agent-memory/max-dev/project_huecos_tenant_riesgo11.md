---
name: huecos-tenant-riesgo11
description: #752, #754 y #759 cierran los huecos de tenant del riesgo 11 (antes de abrir ONE a 4D SOFT); #759 pone exigirModulo en las acciones; siguen abiertos /api/calidad, el bot de WhatsApp y las guardas de bloque sin Clarity
metadata:
  type: project
---

Tres PR, 2026-09-16, sin migración, motivados por dar acceso a ONE a un cliente externo (4D SOFT,
workspace `4d-soft` con solo `valida_api`): cualquier acción que acepte un id ajeno, no pida
sesión o no pida el módulo es explotable por ese usuario.

**#752** (`4dc6b19e`): rutas AFI por workspace, `crearV1Automatica` a `server-only`,
`guardarDatosSarlaft`/`recalcularScoreNegocio` con `negocioEsDelWorkspace`, muro público con gates.

**#754** (`36593225`): `valida-consultas` valida el negocio; `applyPlantilla` con workspace de la
sesión; `procesarDocumento`/`confirmarUploadDocumentoNegocio` con `esRutaDeWorkspace`; referencias
`one://` por workspace; `consultarEpayco` y `listarConsultas` exigen sesión.

**#759** (`b039db8f`, tercera ronda):
- `exigirModulo(REQUISITO.x)` (`src/lib/modulos/exigir-modulo.ts`, criterio puro en `requisito.ts`):
  mismo criterio que `rutaPermitida` más una llave de función (`fab_pago_epayco`,
  `compliance_dual_informa`, `compliance_vinculacion`). **Cierra si no puede leer** (el middleware
  abre). Doble de pruebas: `test/exigir-modulo-doble.ts`.
- Aplicado a: Valida con llave global (Sustenta), `/valida` (Valida), dual, vinculación, expediente
  documental y monitoreo, ePayco (y el reparto/registro con fuente ePayco), crear negocio, gastos,
  horas, cobros rápidos y FAB de pago (Clarity), `updateLineaActiva` (rol + Clarity + línea propia).
- **Se quitó el respaldo a `VALIDA_API_KEY`** en `/valida` y vinculación: los 7 workspaces con esos
  módulos tienen llave propia en Vault (cabecera de `20260915020000`). Un workspace sin llave falla
  a la vista.
- `data` del navegador pasa por lista blanca (`src/lib/negocios/data-escribible.ts`): lo no
  escribible conserva lo guardado. `procesarDocumentoNegocio` ya no hace `fetch`. Con credenciales
  globales de Drive, un id solo se opera si cuelga de la carpeta del negocio o del workspace
  (`src/lib/almacenamiento/drive-del-workspace.ts`).
- `cargarConfigPeriodicidad` salió de `'use server'` (manifiesto 508 → 507).

**⚠️⚠️ Hallazgo del #754 que no se ve leyendo el código:** `storage-js` pega la ruta a la URL sin
codificar y `fetch` normaliza `%2e%2e`, `.%2E`, `.<TAB>.` y `\`. `download`/`createSignedUrl` son
vulnerables; `remove` no.

**⚠️ Hallazgo del #759:** el gate por ruta deja pasar TODO `/api` (`gate.ts` lo dice). Una route
handler no está en el manifiesto de server actions y no hereda la puerta de la pantalla.

**Why:** toda lectura con service role a partir de un dato del navegador es cross-tenant si no se
compara contra la sesión en ese punto; y todo lo que gasta llaves de MeTRIK (Gemini, Valida, Drive
global) necesita la puerta de módulo en la acción, no solo en la pantalla.

**How to apply:**
- Acción nueva que gaste un recurso de MeTRIK o sea de un módulo: `exigirModulo` al inicio, y la
  prueba mockea con `dobleExigirModulo()`.
- Rutas de Storage de afuera por `esRutaDeWorkspace` o `parsearReferenciaOne` (`referencia.ts`).
- Antes de afirmar que un export es un hueco, mirar el manifiesto ([[manifiesto-server-actions]]);
  pruebas vistas caer contra `origin/main` por su aserción y guarda por guarda
  ([[pruebas-por-mutacion]]).
- ⚠️ ABIERTOS tras #759: (1) `/api/calidad/transcribir|auditar|audio-url|guardar` sin módulo:
  owner/admin/supervisor/read_only de cualquier workspace gasta Gemini de MeTRIK; (2) `wa-webhook`
  no mira `modules` (edge function, redeploy manual); (3) `uploadPlanillaPila` sin
  `cobros_recurrentes`; (4) guardas de `guard-negocio.ts` sin Clarity (inertes mientras 4d-soft no
  tenga negocios); (5) confirmar por MCP los 7 nombres `ws:%:valida_api_key` en Vault.
