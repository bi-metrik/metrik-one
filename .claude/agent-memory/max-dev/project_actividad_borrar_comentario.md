---
name: actividad-borrar-comentario
description: Regla de quien borra en la Actividad (autor u owner/admin, solo comentarios) vive en app; la RLS de activity_log sigue dejando borrar a cualquiera del workspace por PostgREST
metadata:
  type: project
---

Desde 2026-09-28 (PR "Actividad: borrar solo comentarios propios", diseño "ONE como capa
visual") `deleteActivity` solo borra `tipo='comentario'` y solo si quien actua es el autor
(`activity_log.autor_id` = `staff.id`) o `owner`/`admin`. La regla es una sola:
`src/lib/activity/borrar-comentario.ts`, usada por el servidor y por `getActivityLog`
(campo `puede_borrar` que decide si se dibuja el boton).

**Why:** antes bastaba conocer el id para borrar el comentario de otro. Se cerro en la capa
de aplicacion, sin migracion, porque el brief prohibia migrar.

**How to apply:** la policy `activity_log_workspace_isolation` es ALL por workspace, asi que
con la anon key + JWT propio un usuario aun puede borrar por PostgREST (mismo hallazgo abierto
de "segmentacion por rol es de aplicacion"). Si se pide cerrarlo de verdad, es una policy de
DELETE por autor/rol: migracion aparte, con autorizacion. La Actividad arranca mostrando todo
(clave localStorage `activity-log:show-system:v2`); no volver al default "solo comentarios".
