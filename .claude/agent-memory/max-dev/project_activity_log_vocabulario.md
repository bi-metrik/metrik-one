---
name: activity-log-vocabulario
description: PR #475 — el vocabulario de activity_log.tipo es fuente única en TS; el CHECK y el backfill YA están aplicados, y la cifra que justifica el frente son 311 eventos, no 754 filas
metadata:
  type: project
---

`activity_log.tipo` tiene **una sola fuente**: `src/lib/activity/tipos.ts` →
`ACTIVITY_LOG_TIPOS` (15 valores). La migración
`20260901000010_activity_log_tipos_vocabulario.sql` escribe el CHECK a partir de esa lista,
y `src/lib/activity/tipos.test.ts` **lee el .sql** y falla si se separan. Todo insert pasa
por `registrarActividad` (`src/lib/activity/registrar-actividad.ts`), y una regla de
`no-restricted-syntax` en `eslint.config.mjs` prohíbe tocar la tabla de frente fuera de
`src/lib/activity/**` (excepción declarada: `supabase/functions/**`, que corre en Deno y no
puede importar de `src/`).

## ⚠️ 754 son FILAS de bloque; 311 son EVENTOS de aprobación

La confusión que los comentarios del #475 dejaron escrita y el PR #477 corrigió:

- **754** = filas de `negocio_bloques` con `data->>'aprobado_at'` no nulo.
- La misma aprobación está **copiada** en el bloque "Propuesta económica" de **cada etapa**
  por la que pasa el negocio: **~2,4 filas por negocio**.
- Los **eventos** distintos, contados por el par `(negocio_id, aprobado_at)`, son **311,
  exactamente uno por negocio**. Ese es el número que mide el hueco del timeline y el que
  escribió el backfill.
- De esas 311, **195 no tienen `aprobado_por`**.
- Rango 2026-04-15 → 2026-09-01. Antes del arreglo: **CERO** filas `propuesta_aprobada`.

**Why:** contar filas de una copia readonly como si fueran hechos infla el dato ~2,4x. El
bloque `propuesta_economica` vive en UNA fila (su etapa nativa) y se hereda de solo lectura
aguas abajo — este repo ya lo documenta para leer `drive_url` y para resolver el origen por
slug; aquí volvió a morder al **contar**.

**How to apply:** antes de citar un conteo sobre `negocio_bloques`, preguntar si el bloque se
hereda. Si se hereda, el conteo honesto agrupa por `(negocio_id, <campo que fecha el hecho>)`,
no por filas.

## Estado del frente (2026-09-01)

- PR **#475** (squash `239f8d0`) mergeado, migración del CHECK **aplicada** en producción.
- Backfill de las **311** aprobaciones: **aplicado** el 2026-09-01.
- PR **#477**: corrección de la cifra en los tres comentarios que la repetían
  (la migración, `registrar-actividad.ts` y `eslint.config.mjs`) + cuerpo del #475 editado.

⚠️ El estado de "aplicado" llegó en el encargo de la sesión principal; **desde el subagente
aislado no se pudo recomprobar** (ver [[sql-prod-one]]). Antes de dar el defecto por cerrado,
comprobar contra producción el `pg_get_constraintdef` del constraint y
`count(*) from activity_log where tipo = 'propuesta_aprobada'` — no el texto del archivo.

## Los dos defectos del SQL de backfill que el #475 proponía

Se corrigieron al aplicarlo, y son reusables como advertencia:

1. **Seleccionaba `nb.workspace_id`, columna que NO existe en `negocio_bloques`.** El
   workspace hay que traerlo con join a `negocios`.
2. **El dedup por `not exists` solo protegía contra re-corridas, no contra duplicados dentro
   del MISMO `INSERT ... SELECT`.** El `not exists` se evalúa contra la tabla como estaba al
   empezar la sentencia, así que las ~2,4 filas de bloque del mismo evento habrían entrado
   todas. Se resolvió con `distinct on (negocio_id, aprobado_at)`.

**How to apply:** en cualquier `INSERT ... SELECT` de backfill, el `not exists` es
idempotencia **entre corridas**; la unicidad **dentro** de la corrida la pone `distinct on`
o un índice único. Son dos problemas distintos y solo uno se ve al releer el SQL.

## Dos trampas que este frente destapó

- **`activity_log.autor_id` es FK a `staff(id)`.** Los tres sitios de platform admin le
  pasaban un `profiles.id`, así que fallaban por el CHECK **y** por la FK: ampliar el CHECK
  solo les habría cambiado el código de error. Van con `autor_id: null` (el platform admin no
  tiene staff en el workspace ajeno, y dárselo sería autoría cross-tenant).
- **`negocio_cancelado` / `negocio_reabierto` / `negocio_reactivado` son `notificaciones.tipo`,
  no `activity_log`.** Aparecen a pocas líneas de estos inserts y un grep con ventana amplia
  los mete en la lista.

Relacionado: [[medir-antes-de-construir]], [[sql-prod-one]].
