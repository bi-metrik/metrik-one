---
name: actividad-borrar-comentario
description: Borrar, editar y escribir en la Actividad; DELETE solo comentarios (#944) y UPDATE solo el 'cambio' propio (#946), aplicadas; INSERT firmado por uno mismo (20260928140000, SIN aplicar al 2026-09-28)
metadata:
  type: project
---

**DELETE (#943 app, #944 base, aplicada).** `deleteActivity` solo borra `tipo='comentario'` y
solo si quien actua es el autor (`activity_log.autor_id` = `staff.id`) o `owner`/`admin`. La
regla es una sola: `src/lib/activity/borrar-comentario.ts`. La base: politica
`activity_log_delete_comentario` (`20260928120000`), que partio la FOR ALL en cuatro.

**UPDATE (#946, migracion `20260928130000`, aplicada el 2026-09-28).** Con solo #944 un operador reescribia un `cambio_etapa` ajeno a
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
- Ensayo: `src/lib/activity/update-activity-log-sql.test.ts` (PGlite, corre en CI) carga los
  dos archivos tal cual y actua como `authenticated` con JWT.

**INSERT (PR `fix/rls-insert-activity-log`, migracion `20260928140000`, SIN aplicar al
2026-09-28).** Politica `activity_log_insert_propio` (TO authenticated): mismo workspace, tipo
en lista cerrada de sesion (comentario, cambio, sistema, cambio_etapa, cambio_estado,
cambio_sistema, propuesta_aprobada, drive_folder_skipped/failed) y
`activity_log_autor_coherente(ws, autor, tipo)` (SECURITY DEFINER): autor = staff propio del
ws (sin filtrar is_active, igual que getWorkspace); null solo sin staff en el ws, platform_admin
o nota de Drive; platform_admin firma por cualquier staff del ws = "Ver como" sin tocar codigo.
Inventario: todo insert de la app pasa por `registrarActividad` (~85 llamadas) + el handler WA
(service). El sistema (crons, webhooks, platform_admin_enter/exit, Siigo, facturacion) va por
service_role.

**How to apply (INSERT):**
- Un tipo NUEVO insertado con cliente de sesion exige ampliar la lista de la politica (paso 4
  de `src/lib/activity/tipos.ts`), o se pierde con un console.error.
- Firmar por otro staff (fuera de "Ver como") o escribir un tipo de sistema: cliente de servicio.
- `current_user_staff_id()` NO filtra workspace: un platform_admin con staff en su ws de origen
  lo devuelve aunque este en el de un cliente. Por eso el helper nuevo mira `workspace_id`.
- `force_unlock_bloque` (SECURITY DEFINER) firma con `p_forced_by` sin validarlo: residual.
- Ensayo: `src/lib/activity/insert-activity-log-sql.test.ts` (PGlite, CI).
