---
name: project-copia-carta-autorizacion
description: Copia (documento) de la carta de autorización en etapas posteriores de SOENA; desde 2026-10-08 la de Cita genera en el origen con `genera_en_origen` (UPDATE pendiente tras el merge)
metadata:
  type: project
---

2026-10-06 (#1057): copia `documento` readonly que lee el `drive_url` del formulario `carta_autorizacion_generar`
(`src/lib/negocios/copia-de-formulario.ts`), en 5 etapas (13, 14, 16, 18, 19).

2026-10-08 (feat/carta-generable-desde-cita): Mauricio pidió generar desde la copia de Cita (el alcance que el 06 se
había descartado). Flag por config `genera_en_origen: true` en la copia → la ficha la pinta con `BloqueFormulario` y
las acciones de formulario resuelven la fila con `filaDelFormulario` (`src/lib/negocios/fila-formulario.ts`):
guard sobre la COPIA, escritura en el ORIGEN. `resolverDestino` solo redirige esa copia con `{ generaEnOrigen: true }`.
El origen se oculta del historial cuando la etapa actual tiene la copia generable.

**Why:** el equipo trabaja en Cita y no encontraba el generador (vivía en el historial cerrado, editable por
`editable_siempre`). Una fila, un PDF, una serie de versiones.

**How to apply:** el flag NO hace nada hasta el UPDATE de `f25d432f` (SQL con reversa en
`proyectos/soena/ve/migrations/2026-10-08_carta-generable-cita.sql`), que corre la sesión principal tras el merge y el
deploy. Para extenderlo a otra copia de formulario basta el flag en su config; no ponerle `editable_siempre` (eso abre
SUBIR archivos a la fila del formulario). Relacionado: [[factura-copia-escribe-origen]].
