---
name: project-plantillas-editables
description: Plantillas editables de documentos (DJ y Relación) por workspace — 203000/203100 APLICADAS (29-oct); DJ v2 sin «aproximado» en 20261030120000 SIN aplicar; nada activo; Chromium sin respaldo
metadata:
  type: project
---

Módulo `src/lib/plantillas-documento/` + pantalla `/mi-negocio/plantillas` (aprobado por Mauricio el 2026-10-29, proyecto SOENA).
PR #1356. El IVA exacto (#1355) ya está en main.

- Migraciones `20261029203000` (3 tablas, RLS) y `20261029203100` (SOENA: 4 editores
  buscados por nombre, ABORTA si alguno no aparece 1 vez; v1 de DJ y Relación SIN activar). Las aplicó la sesión principal el 29-oct, antes del merge.
- La lista de editores es por SQL, nunca por rol. Leidy (supervisor) fuera a propósito.
- Sin fila en `plantillas_documento_activas` = componente @react-pdf de siempre. Con activa, Chromium y SIN
  respaldo: si falla, error (no imprime el texto viejo). `leerVersionActiva` trata la tabla ausente como «sin activa».
- `iva_solicitado` = IVA exacto (decisión 29-oct); no hay variable «al mil».
- Letra Liberation Sans (métrica Helvetica): el texto de la v1 es idéntico al de @react-pdf en 4 casos; la DJ con
  dos titulares cabe en 1 hoja en Chromium (2 en @react-pdf).
- `resolverCamposFuente` salió de `formulario-actions.ts` a `src/lib/formularios/` (un 'use server' no puede exportarla).

**Why:** SOENA quiere cambiar sus textos sin pedir deploy; son documentos bajo juramento ante la DIAN.
- 30-oct: plantilla v2 de Deisy quita «(valor aproximado… art. 577 ET)» del CUARTO (la DIAN rechaza valores
  aproximados). `DJ_V1` en `v1.ts` lleva ya el texto corregido; la v1 sembrada (inmutable) conserva la frase y
  `20261030120000_plantillas_documento_soena_dj_v2.sql` (SIN aplicar al abrir el PR) agrega la v2 con
  version_n = max+1 y dedupe por contenido exacto. No poner la frase de nuevo.

**How to apply:** el texto vigente vive en `v1.ts` Y en la ÚLTIMA migración de siembra; `plantillas-sql.test.ts`
exige que coincidan (la v1 se compara con `DJ_V1` + la frase quitada). Un cambio de texto = migración nueva, nunca
editar la vieja. Una PGlite nueva tarda >5 s: las pruebas que la crean llevan timeout 30 s.
Para un documento nuevo, seguir `docs/specs/2026-10-29_plantillas-editables.md`.
