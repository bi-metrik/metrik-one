---
name: project-plantillas-editables
description: Plantillas editables de documentos (DJ y Relación) por workspace — 29-oct; migraciones 20261029203000/203100 APLICADAS (29-oct); siembra SOENA sin activar; Chromium sin respaldo
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
**How to apply:** el texto de v1 vive en `v1.ts` Y en la migración; `plantillas-sql.test.ts` exige que coincidan.
Para un documento nuevo, seguir `docs/specs/2026-10-29_plantillas-editables.md`.
