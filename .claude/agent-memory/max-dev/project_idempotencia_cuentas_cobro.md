---
name: idempotencia-cuentas-cobro
description: #694 (2026-09-14) — la idempotencia del emisor de cuentas es POR COBROS y una anulada libera; anular la unica cuenta viva hace que el cron la re-emita; el camino explicito sigue bloqueando con anuladas; y el paso 3 que insertaba cobros "pagados" se arreglo en #698, mergeado tras medir impacto cero contra los planes vivos
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

**Paso 3 sin `fecha: null` → PR #698 (2026-09-14), mergeado con impacto actual medido en cero.**
El paso 3 de `generarCuentasCobroPeriodo` insertaba el cobro programado sin `fecha: null`;
`cobros.fecha` tiene `DEFAULT CURRENT_DATE` → nacia "pagado", la relectura (`fecha is null`) lo
excluia de su cuenta, y al dia siguiente el paso 3 lo saltaba y el paso 1 chocaba con el unique:
cuota pagada para siempre sin cobrarse. 0 filas historicas. **El paso 3 SI es camino real, no
respaldo muerto:** el paso 1 del cron solo crea la cuota T+3 antes del vencimiento (dia 12 para el
15) y la ventana de emision abre el dia 10, asi que una cuota no pre-creada la inserta el paso 3.

**Por que se mergeo sin esperar a Mauricio** (primero se retuvo por [[cobros-emision-gate]], Mik
midio en solo lectura y se libero): solo `metrik` tiene `modules.cobros_recurrentes=true`, y sus 4
planes uniformes activos (S1 26 2 con 6/6 cobros; A1 26 1, A1 26 2 y A1 26 3 con 12/12) ya tienen
TODAS las cuotas creadas → el paso 3 siempre cae en `existing` y lo emitido hoy no cambia. `advise`
tiene planes uniformes pero sin el flag. Solo cambiaria con un plan uniforme nuevo, y ahi lo correcto
es emitirlo. **Regla afinada:** un cambio a lo que emite el cron se mide contra los planes vivos
(flag por workspace + cuotas ya creadas) ANTES de retenerlo; impacto actual cero → merge por la
regla 8. Retener sin medir fue el error de este PR.

**Gotcha del doble (`test/cuentas-cobro-doble.ts`):** su `.is(campo, null)` trata una clave AUSENTE
como null, asi que sin simular el DEFAULT (`estado.defaults`) la prueba de la consecuencia pasa
contra el codigo roto — control corrido. Desde #698 el doble tiene `insert`, `defaults` y
`embebidos` (join resuelto al leer); una prueba que recorra el paso 3 corre con `dryRun: false`.

**Why:** por que el gate de [[cobros-emision-gate]] no freno este merge: se midio que la corrida
del dia siguiente emitia 0 cuentas con el codigo nuevo (generador real en dry-run contra prod con
un cliente que bloqueaba escrituras y RPC) contra 1 duplicado con el viejo. Un PR que solo QUITA
emisiones no autoriza ninguna.

**How to apply:** antes de tocar la idempotencia de cobros, correr `generar-cuentas-cobro.test.ts`
(su doble hace fallar `maybeSingle` con 2+ filas como PostgREST) y medir en dry-run contra prod con
el mismo cliente de solo lectura.
