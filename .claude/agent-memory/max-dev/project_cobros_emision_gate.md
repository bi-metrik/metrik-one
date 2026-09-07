---
name: cobros-emision-gate
description: Mergear cambios al cron de cobros equivale a autorizar una emisión real en producción; la emisión de cuentas la autoriza Mauricio explícitamente
metadata:
  type: project
---

La emisión real de cuentas de cobro la autoriza **Mauricio**, siempre y explícitamente. El dry-run de `scripts/emitir-cuentas-periodo.ts` se puede correr libre; `--commit` no.

**Why:** una cuenta emitida escribe fila en `cuentas_cobro_emitidas`, sube un PDF a Drive con el correlativo `CC-YYYY-MM-NNN` quemado, y consume número de una serie que se le muestra al cliente. Deshacerlo es anular, no borrar (CC-2026-06-003 quedó `anulada` en la historia de Trappvel).

**How to apply:** el gate no es solo el flag `--commit`. El cron `/api/crons/procesar-planes-cobro` corre a diario (13:00) y emite todo lo que encuentre desde el día 10 del mes. Un PR que cambie **qué** emite ese cron dispara emisiones reales en producción en la siguiente corrida, horas después del merge. Esos PRs NO caen en el merge automático de [[branch-workflow-one]] aunque los checks estén verdes y no haya migración: se reportan y espera el sí de Mauricio. Pasó en el PR #330 (2026-08-20), que hizo que el cron por fin viera el cronograma explícito de Trappvel.

Relacionado: [[emision-cuentas-cobro-solo-en-produccion]] (por qué además no se puede
emitir desde local, y el paso 4 del cron que sigue sin decisión).
