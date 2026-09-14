---
name: idempotencia-cuentas-cobro
description: #694 (2026-09-14) — la idempotencia del emisor de cuentas es POR COBROS y una anulada libera; anular la unica cuenta viva hace que el cron la re-emita; el camino explicito sigue bloqueando con anuladas; y el paso 3 inserta cobros "pagados"
metadata:
  type: project
---

**PR #694 mergeado y desplegado el 2026-09-14** (merge 16:36:07Z, Production 16:37:41Z). El cron
`procesar-planes-cobro` emitio la misma agrupada de AFI cada dia desde el 10-sep (CC-2026-09-002,
005..008) porque la idempotencia era "una cuenta por empresa+periodo" con `.maybeSingle()` y el
error descartado: con la agrupada + la de licencias en el mes habia 2 filas → null → emitia.

**Criterio vigente** (`src/lib/cobros/idempotencia-cuenta.ts`, puro): un grupo ya esta emitido si
sus cobros estan en alguna cuenta **viva** (estado != `anulada`) del workspace, sin filtrar empresa
ni periodo (`cobros_ids && grupo`). Parcial = no emite y va a `errores`.

⚠️ **Consecuencia operativa: anular la UNICA cuenta viva de un grupo = el cron la re-emite en la
siguiente corrida** (la ventana abre el dia 10 y no cierra). Para corregir un duplicado se anulan
las copias y se deja viva una. Al 14-sep Mik ya habia anulado 005..008 y dejado 002.

⚠️ **Los dos caminos NO usan la misma regla con anuladas.** `emitirCuentaDesdeCuota` (cronograma
explicito) sigue contando la anulada como bloqueo, a proposito (comentario del caso Trappvel:
reemitir sobre una anulacion es decision de una persona). No se alineo en #694: es decision de
Mauricio, no defecto.

⚠️ **Hallazgo abierto, sin tocar:** el paso 3 de `generarCuentasCobroPeriodo` inserta el cobro
programado SIN `fecha: null`, y `cobros.fecha` tiene `DEFAULT CURRENT_DATE` → nace con aspecto de
pagado y la relectura (`fecha is null`) lo excluye de su propia cuenta. Hoy no muerde porque las
cuotas de metrik ya estaban pre-creadas. Arreglarlo cambia QUE se emite ([[cobros-emision-gate]]).

**Why:** por que el gate de [[cobros-emision-gate]] no freno este merge: se midio que la corrida
del dia siguiente emitia 0 cuentas con el codigo nuevo (generador real en dry-run contra prod con
un cliente que bloqueaba escrituras y RPC) contra 1 duplicado con el viejo. Un PR que solo QUITA
emisiones no autoriza ninguna.

**How to apply:** antes de tocar la idempotencia de cobros, correr `generar-cuentas-cobro.test.ts`
(su doble hace fallar `maybeSingle` con 2+ filas como PostgREST) y medir en dry-run contra prod con
el mismo cliente de solo lectura.
