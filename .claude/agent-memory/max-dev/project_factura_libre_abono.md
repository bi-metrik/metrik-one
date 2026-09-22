---
name: factura-libre-abono
description: "#818 en main (345ab68), SQL de SOENA aplicado. #823 (SIN mergear): el recibo de Tesorería es solo el RC-3 UPME y el abono es automático e invisible; el rezago (34 pagos, $17,2M) lo corre la sesión principal con --commit"
metadata:
  type: project
---

**#818** (`345ab68`, en main): la factura ya no espera el recaudo y el honorario se ABONA a
ella (RC-1 `DebtPayment`). El SQL que pone `tipo: 'abono'` en el honorario de SOENA **ya está
aplicado** (leído el 2026-09-22). Revierte el gate de [[gate-recaudo-facturacion]].

**#823** (rama `feat/recibo-solo-upme-abono-automatico`, **SIN mergear**): brief del
2026-09-22 «Tesorería solo emite recibos de la tarifa UPME».

**Why:** Mauricio: «no nos debería permitir generar recibos de caja diferentes a la tarifa
UPME». El abono es un asiento interno: sin botón, sin PDF, sin correo.

## How to apply

- ⚠️⚠️ **Rezago SIN correr:** `npx tsx scripts/abonar-rezago.ts soena` simula (solo lee, no
  toca Siigo); `--commit` emite. Medido con el código del PR: **34 pagos, 30 negocios,
  $17.204.707**. Lo corre la sesión principal con autorización de Mauricio, **después** del
  merge y deploy. Es idempotente: la segunda corrida da 0.
- **Dónde se engancha el abono:** `abonarAlRegistrarPago(ws, negocioId)` en
  `siigo/recibo-automatico.ts`, en TODOS los caminos de plata recibida (ePayco y pago externo
  vía `alRegistrarCobro`; `registrarPagoEnNegocio`, `autoCrearCobros*`, `repartirPagoCore`,
  `aceptarRepartoComercial`, `redistribuirReferencia`). Recorre el NEGOCIO, así que un abono
  fallido se reintenta con el siguiente pago. Nunca lanza.
- **Criterio único:** `porQueNoSeAbona` (`siigo/abono-pendiente.ts`), compartido por el
  disparo, la factura y el lote. Una porción del comercial sin aceptar NO se abona (un abono no
  se deshace y el reparto todavía se mueve). Un «a mano» no se reintenta, salvo
  `factura_sin_vinculo` cuando la factura ya tiene `siigo_id`.
- ⚠️ `recibo_automatico` ahora gobierna SOLO el RC-3 (`soloComponentes: ['pasante']`).
- ⚠️ **En SOENA el `reciboDocumentId` del workspace es 4594 (RC-1).** Una línea sin
  `recibo_por_concepto.pasante` caería al recibo por el total = RC-1 a mano: la acción la
  rechaza.
- El abono ya no entra en `data.recibos` del bloque. El correo de [[correo-recibo-dos-documentos]]
  nombra solo el RC-3.
- ⚠️⚠️ **El `prefix` de la factura NO es el del vencimiento** (`SOE` vs `FV-2`). Se arma del
  nombre (`abono.ts`). **Tope = `balance` del GET de la factura.**
- **Nunca se hizo un POST a Siigo real.** Sin verificar: abono fechado antes de su factura
  (hay reintento con la fecha de la factura ante un 4xx).

Relacionado: [[recibo-por-concepto]], [[pruebas-por-mutacion]], [[arbol-limpio-por-tarball]].
