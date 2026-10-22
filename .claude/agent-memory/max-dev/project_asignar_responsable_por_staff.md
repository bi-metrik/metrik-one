---
name: project-asignar-responsable-por-staff
description: Lista config_extra.asignar_responsable.staff_ids deja a un operator asignar/quitar responsables de negocio; RLS de negocio_responsables no filtra por rol
metadata:
  type: project
---

Desde 2026-10-22 (rama feat/asignar-responsable-por-staff) quien asigna responsables de un NEGOCIO lo decide `puedeAsignarResponsable` (`src/lib/permissions/asignar-responsable.ts`): rol con `canAssignResponsable` O `staff.id` en `config_extra.asignar_responsable.staff_ids` (solo uuid, fail-closed). Lectura con config en `asignar-responsable-servidor.ts` (service client). Directorio (contactos) NO usa la lista, a propósito.

**Why:** decisión de Mauricio: darle el permiso a un operator sin subirle el rol (mismo patrón que `omitir_gate.staff_ids`).

**How to apply:** el SQL para poner la lista en un workspace NO va en el PR; lo pide la sesión principal. Cualquier rol en la lista pasa (también read_only/contador). Riesgo abierto: RLS `negocio_responsables_write` (20260520000006, 20260831000004) solo mira workspace, así que cualquier rol escribe directo por cliente. Ver [[project-operador-sin-staff-no-ve]].
