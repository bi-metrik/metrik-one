---
name: actividad-borrar-comentario
description: Borrar y editar en la Actividad; DELETE solo comentarios (#944, aplicada) y UPDATE solo el evento 'cambio' propio con grant por columnas (20260928130000, SIN aplicar al 2026-09-28)
metadata:
  type: project
---

**DELETE (#943 app, #944 base, aplicada).** `deleteActivity` solo borra `tipo='comentario'` y
solo si quien actua es el autor (`activity_log.autor_id` = `staff.id`) o `owner`/`admin`. La
regla es una sola: `src/lib/activity/borrar-comentario.ts`. La base: politica
`activity_log_delete_comentario` (`20260928120000`), que partio la FOR ALL en cuatro.

**UPDATE (PR `fix/rls-update-activity-log`, migracion `20260928130000`, SIN aplicar al
2026-09-28).** Con solo #944 un operador reescribia un `cambio_etapa` ajeno a
`tipo='comentario'` con su `autor_id` y luego lo borraba. El UNICO UPDATE de usuario sobre
`activity_log` es `actualizarActividad` (refresco del evento `tipo='cambio'` de
`registrarCorrecciones`, columnas contenido/valor_nuevo/valor_anterior). La politica nueva
`activity_log_update_correccion_propia` (TO authenticated) solo deja ese evento propio, y un
`grant update (contenido, valor_nuevo, valor_anterior)` fija las demas columnas (42501).
**Nadie edita comentarios**, ni autor ni admin: la app no lo ofrece.

**Why:** la politica tiene que espejar lo que la app hace; cerrar DELETE sin UPDATE dejaba la
historia editable.

**How to apply:**
- Ampliar lo que `actualizarActividad` escribe exige ampliar el grant por columnas, o da 42501.
  Una migracion futura con `grant all ... to authenticated` reabriria las columnas.
- En "Ver como" el evento lleva el staff del impersonado y la sesion es del admin: el refresco
  da 0 filas. `actualizarActividad` ahora lo reporta (`.select('id')`), no lo arregla.
- `retirarRegistro` de `mi-negocio/margen-actions.ts` depende del cliente de servicio.
- INSERT sigue sin validar autor ni tipo (se puede forjar autoria): propuesta en el PR, sin
  implementar. Chocaria con "Ver como" (inserta con el staff del impersonado).
- Ensayo: `src/lib/activity/update-activity-log-sql.test.ts` (PGlite, corre en CI) carga los
  dos archivos tal cual y actua como `authenticated` con JWT.
