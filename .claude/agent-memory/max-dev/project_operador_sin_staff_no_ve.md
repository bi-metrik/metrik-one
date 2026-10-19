---
name: project-operador-sin-staff-no-ve
description: #1205 (SIN mergear) — getNegociosV2 da [] al operator sin staffId; alma-afi tiene 4 staff sin profile_id que el autocreado de #988 duplicaría
metadata:
  type: project
---

PR #1205 (rama fix/alma-operador-sin-staff-no-ve-negocios, 2026-10-18, sin migración, sin mergear: lo decide Mauricio). `getNegociosV2` usaba `role === 'operator' && staffId`; sin staffId el operador veía todo el workspace (el RLS de `negocios` solo aísla por workspace). Ahora devuelve []. El detalle y `canViewNegocio` ya tenían ese default.

Medido en prod el 18-oct: el único operador sin staff de toda la base está en alma-afi y nunca ha entrado; #988 le crea el staff al primer ingreso. alma-afi tiene 0 negocios y no tiene el módulo business.

**Why:** #988 autocrea, pero staffId sigue quedando null si el staff vive en otro workspace, si el upsert falla o si el rol es contador.

**How to apply:** alma-afi tiene 4 filas de staff SIN profile_id. El autocreado inserta una fila NUEVA en vez de vincular, así que habría duplicados si alguna es de Yessica u Oscar. Revisar esto antes de su primer ingreso. Ver [[project-trigger-staff-rol-sin-contador]].
