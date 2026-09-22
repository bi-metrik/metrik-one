---
name: factura-libre-abono
description: "#818 y #823 en main (15ba047). #828 (SIN mergear): el control de duplicados del abono exige la MISMA factura (items[].due) y pagina hasta el final; sin eso frenó el abono de V0409 por el de su vehículo hermano"
metadata:
  type: project
---

**#818** (`345ab68`, en main): la factura ya no espera el recaudo y el honorario se ABONA a
ella (RC-1 `DebtPayment`). El SQL que pone `tipo: 'abono'` en el honorario de SOENA **ya está
aplicado** (leído el 2026-09-22). Revierte el gate de [[gate-recaudo-facturacion]].

**#823** (`15ba047`, en main desde el 2026-09-22): brief «Tesorería solo emite recibos de la
tarifa UPME».

**Why:** Mauricio: «no nos debería permitir generar recibos de caja diferentes a la tarifa
UPME». El abono es un asiento interno: sin botón, sin PDF, sin correo.

## How to apply

- **Rezago:** `npx tsx scripts/abonar-rezago.ts soena` simula (solo lee, no toca Siigo);
  `--commit` emite. Medido antes: 34 pagos, 30 negocios, $17.204.707. La sesión principal lo
  corrió el 2026-09-22 (RC-1-96 de V0408 salió a las 22:10 UTC); ahí apareció el falso
  duplicado de V0409. Es idempotente: la segunda corrida da 0.
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

## #828 (rama `fix/abono-duplicado-por-factura`, SIN mergear): el control de duplicados

**Why:** el rezago corrió el 2026-09-22 y V0409 (FV-2-528) no recibió abono: el control viejo
comparaba cliente + valor y tomó RC-1-96 (abono de V0408, vehículo hermano, contra FV-2-511,
mismo valor y día). La sesión principal le dejó a V0409 una marca `abono_a_mano`
`duplicado_en_siigo` a mano; no se reintenta sola.

**How to apply:**
- Duplicado = algún `items[].due` (prefix+consecutive) apunta a la factura **y** mismo valor.
  Fecha NO. Los abonos que ONE ya le emitió al negocio siguen excluidos (plan 50/50).
- `vouchersDelComprobante` (`recibos.ts`) pagina y LANZA si la lista no es completa; en el
  abono eso deja `abono_a_mano` `abonos_sin_revisar` (nunca a ciegas). El RC-3 traga el error.
- ⚠️ **Sin verificar contra Siigo real si la LISTA `/v1/vouchers` trae `items`.** Si no los
  trae, el código pide `GET /v1/vouchers/{id}` de cada abono del cliente (tope 50).
- Duplicado y sin-revisar NO se reintentan (igual que los demás «a mano», salvo factura sin
  vínculo): una falla transitoria de Siigo le deja trabajo a Tesorería.
