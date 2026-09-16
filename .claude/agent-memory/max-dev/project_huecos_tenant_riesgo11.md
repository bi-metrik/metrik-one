---
name: huecos-tenant-riesgo11
description: #752, #754, #759 y #761 cierran los huecos de tenant del riesgo 11 (antes de abrir ONE a 4D SOFT); #761 cierra /api/calidad, el bot, PILA y bloques/etapas; wa-webhook SIN redesplegar y HMAC sin validar
metadata:
  type: project
---

Cuatro PR, 2026-09-16, sin migración, motivados por dar acceso a ONE a un cliente externo (4D SOFT,
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

**#761** (`adf063da`, cuarta ronda, cierra los 4 abiertos del #759):
- `/api/calidad/*` con `puertaModuloLlamadas()` (`src/lib/calidad/puerta-modulo.ts`,
  `REQUISITO.llamadas`); `transcribir` ahora valida con `esRutaDeWorkspace` (el `%2e%2e` pasaba).
- `wa-webhook`: `botEquipoPermitido(user.modulos)` (`_shared/wa-modulos.ts`) tras la aceptación de
  términos y antes de Gemini; sin fila de workspace cierra. Su prueba compara contra
  `REQUISITO.clarity` y lee el fuente de `index.ts` para fijar el ORDEN (el handler no se colecta).
- `uploadPlanillaPila` con `REQUISITO.cobrosRecurrentes`.
- `guard-negocio.ts` exige Clarity en `resolverCtx` (los 3 guards y `esGerencial`). ⚠️
  `guardDocumentoNegocio` de `ve-documentos` hace `guard.ok || puedeCorregirDocumentos(role)`: la
  puerta del guard NO basta ahí, el módulo va antes y aparte. Además estado/etapa sin guard
  (`cambiarEtapaNegocio`, perder/pausar/reactivar/cancelar/completar, reproceso x3, `devolverBloque`,
  reabrir, `crearNegocioDesdeCerrado`) y `leerPantallazoDeItem`.
- Medido por PostgREST antes de cerrar: fuera de Clarity solo 2 negocios (advise, dormidos);
  cero mensajes del bot de equipo desde workspaces sin Clarity; 4d-soft en `active` (el bot ya lo
  frenaba por plan), alma-afi y advise en `trial` (esos sí pasaban).

**⚠️ Al meter `exigirModulo` en un helper compartido, las pruebas viejas que no lo mockean revientan**
en `getCachedUser` → `createClient` ("No createClient export on the mock"). En #761 cayeron
`reproceso-sin-retorno` y `documentos-ruta-workspace`; se arreglan con `dobleExigirModulo()` (su
estado por defecto ya es Clarity).

- ⚠️⚠️ ABIERTOS tras #761: (1) **`wa-webhook` sin redesplegar** (lo hace la sesión principal, con
  `--no-verify-jwt`); (2) HMAC de `wa-webhook` sin validar ([[aceptacion-terminos-wa]]); (3) las
  puertas son de aplicación: con su JWT, un usuario escribe `negocios`/`etapa_actual_id` por PostgREST
  y el trigger de aviso dispara igual; (4) sin puerta (no gastan llaves): `/api/negocios/export`,
  `/api/revision/export`, `bloque-locks`, nombre/carpeta/responsables/precio/`confirmarPagoCobro`;
  (5) confirmar por MCP los 7 nombres `ws:%:valida_api_key` en Vault.
