---
name: staff-unique-global
description: staff es 1 fila por persona en TODA la base (UNIQUE global profile_id) — el platform_admin que cambia de workspace queda con staffId null ahí, y la migración a (workspace_id, profile_id) quedó propuesta sin aplicar
metadata:
  type: project
---

`staff.profile_id` tiene `staff_profile_id_key = UNIQUE (profile_id)` **global**: el
modelo real es "una persona = un staff en toda la plataforma", no por workspace. La
policy `staff_ws` (ALL, `workspace_id = current_user_workspace_id()`) hace que toda
lectura autenticada de `staff` sea ciega a registros de otros workspaces.

**Why:** el switch de platform_admin mueve `profiles.workspace_id` pero el staff se
queda en el workspace de origen. Eso producía el 23505 repetido de `getWorkspace`
(cerrado en el PR #453, 2026-08-31): insert a ciegas + relectura con RLS que salía
vacía. Medido ese día: 1 solo caso en toda la base (Mauricio, profile en soena,
staff en metrik).

**How to apply:**
- Desde el PR #453, un platform_admin parado en un workspace ajeno opera con
  `staffId: null` **a propósito** (sin error, con un `console.warn` una vez por
  instancia): no es un bug, es el límite del modelo. Lo que escriba ahí queda sin
  autor de staff — igual que antes, pero ya sin ruido en el log.
- Si algún día se necesita que el platform_admin tenga autoría de staff en cada
  workspace, el camino es la migración del unique a `(workspace_id, profile_id)`.
  Quedó **propuesta y NO aplicada** (toca datos/constraints de producción; decide
  Mauricio). Al aplicarla habría que revisar los consumidores que asumen "un staff
  por profile" (`staff.profile_id` como puente a salario en bonos, `maybeSingle()`
  sobre profile_id en varios sitios).
- El patrón de resolución correcto para leer staff de un profile sin la ceguera de
  RLS es el service client por `profile_id` a secas (ver `get-workspace-impl.ts`).

Relacionado: [[sql-prod-one]], [[medir-antes-de-construir]].
