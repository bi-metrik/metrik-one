---
name: huecos-tenant-riesgo11
description: PR #752 cierra 4 huecos de tenant (rutas AFI, crearV1Automatica, SARLAFT, muro público); quedan ABIERTOS consultarValida (reabre el de SARLAFT), applyPlantilla sin sesión, storagePath sin prefijo y registrarMapeoAutomatico
metadata:
  type: project
---

**PR #752** (rama `fix/huecos-seguridad-riesgo11`, 2026-09-16), sin migración. Cierra los cuatro
huecos que la revisión del riesgo 11 encontró en `main` (no los introdujo C2,
[[modulo-valida-api-c2]]):

1. `/api/afi/generar` y `/api/afi/contrato`: el negocio se busca con `.eq('workspace_id', sesión)`;
   ajeno = 404 (no 403).
2. `crearV1Automatica` → `src/lib/propuesta/v1-automatica.ts` (`server-only`), con guarda: no pisa
   un bloque aprobado, con versiones o con `precio_base_con_iva` ya puesto.
3. `guardarDatosSarlaft` / `recalcularScoreNegocio`: `negocioEsDelWorkspace` antes de escribir.
4. Muro público: `getMuroPublico(token)` en `calidad/muro-publico.ts` (`server-only`) con los tres
   gates adentro; `getMuro` usa `leerMuroDeWorkspace` del mismo módulo.

**Why:** los cuatro escribían o leían con service role a partir de un id del navegador. Que 2 y 4
eran alcanzables se probó en el manifiesto de server actions ([[manifiesto-server-actions]]), no
por estar en un `'use server'`.

**⚠️ Quedaron ABIERTOS a propósito (el encargo pidió reportarlos sin arreglar), con archivo:línea
en el cuerpo del PR:**
- `valida-consultas.ts` `consultarValida`: `opts.negocio_id` sin validar → **reabre el hueco 3 por
  otra puerta** (persiste score de un negocio ajeno) y `listarConsultasValida` filtra código y
  nombre del negocio ajeno. Es el más urgente.
- `onboarding/actions.ts` `applyPlantilla(workspaceId, lineaId)`: acción registrada **sin sesión**
  que corre `apply_plantilla_to_workspace` y cambia `linea_activa_id` de cualquier workspace.
- `procesarDocumento` y `confirmarUploadDocumentoNegocio`: `storagePath` del navegador se descarga
  y se **borra** con service role sin validar el prefijo del workspace.
- `centro-costos-asignar.ts`: `registrarMapeoAutomatico` sin sesión (escribe) y
  `proponerCentroCostos` (lee) con `workspaceId` del caller.
- Latentes: `src/lib/afi/generar-*.ts` son `'use server'` sin controles; hoy no registradas.

**How to apply:** antes de tocar cualquiera de esos archivos, comprobar si ya se cerró (buscar el
PR). Un arreglo nuevo de este tipo se prueba igual: doble que aplica los `.eq()` y registra
escrituras, visto fallar contra `origin/main` y quitando la guarda ([[pruebas-por-mutacion]]).
