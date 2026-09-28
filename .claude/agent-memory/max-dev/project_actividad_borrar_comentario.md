---
name: actividad-borrar-comentario
description: Borrar en la Actividad = solo comentarios, autor u owner/admin; regla en app (#943) y RLS de DELETE en migracion 20260928120000 SIN aplicar; UPDATE sigue abierto y la puentea
metadata:
  type: project
---

Desde 2026-09-28 (#943) `deleteActivity` solo borra `tipo='comentario'` y solo si quien actua
es el autor (`activity_log.autor_id` = `staff.id`) o `owner`/`admin`. La regla es una sola:
`src/lib/activity/borrar-comentario.ts`, usada por el servidor y por `getActivityLog`
(`puede_borrar`). La Actividad arranca mostrando todo (`activity-log:show-system:v2`).

La base lo alcanza con `20260928120000_activity_log_borrar_solo_comentarios.sql`
(PR `fix/rls-delete-activity-log`, **SIN aplicar al 2026-09-28**): parte la policy FOR ALL
`activity_log_workspace_isolation` en SELECT/INSERT/UPDATE identicas (TO public) + DELETE
`TO authenticated` con tipo='comentario' y (`current_user_profile_role()` in owner/admin o
autor_id = `current_user_staff_id()`). Dry-run del archivo real dio a=0 b=1 c=1 d=0 e=0.

**Why:** con la anon key + JWT propio cualquiera del workspace borraba comentarios ajenos y
cambios de etapa por PostgREST (medido: 1 y 1 antes de la migracion).

**How to apply:**
- La migracion va ANTES del merge. Tras aplicarla, `retirarRegistro` de
  `mi-negocio/margen-actions.ts` depende del cliente de servicio (borra filas `cambio`); si
  alguien lo regresa al cliente de sesion, el borrado da 0 filas sin error.
- ⚠️ La policy de UPDATE sigue siendo solo por workspace: medido en el dry-run, un operador
  reescribe un `cambio_etapa` ajeno a `tipo='comentario'` con su `autor_id` (1 fila) y luego
  lo borra (1 fila). Tambien reescribe comentarios ajenos. Cerrar DELETE sin UPDATE deja la
  historia editable; es el siguiente frente, con autorizacion.
- INSERT tampoco valida autor ni tipo (se puede forjar autoria); mismo hallazgo abierto de
  "la segmentacion por rol es de aplicacion".
