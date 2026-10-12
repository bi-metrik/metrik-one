---
name: project-fecha-pagos-epayco-bloque
description: SOE-013 — en el bloque «Pagos» (ePayco) pagos[].fecha viejo es el día del registro; la fecha del pago sale de cobros.fecha por external_ref; multi-pago sigue fechando por registro
metadata:
  type: project
---

`negocio_bloques.data.pagos[].fecha` del bloque «Pagos» de ePayco fue el día del REGISTRO en ONE hasta SOE-013 (PR del 2026-10-11, rama fix/soe-013-fecha-pagos-epayco). La fecha del pago vive en `cobros.fecha` (decisión 2026-08-18) y se enlaza por `external_ref = String(ref_payco)`; el bloque la lee de ahí (`lib/epayco/fecha-de-pago.ts`) y solo cae a `pagos[].fecha` sin cobro. Desde SOE-013 la acción guarda en `pagos[].fecha` la misma fecha del cobro. No se corrigieron datos viejos: no hace falta mientras el bloque lea el cobro.

**Why:** Daniela (SOENA) pidió ver la fecha; mostrar `pagos[].fecha` corría un día V0136 (ref 386159602).

**How to apply:** cualquier lector nuevo de `pagos[].fecha` de pagos viejos debe ir al cobro.

Multi-pago (2026-10-12, fix/fecha-cobro-multipago): `autoCrearCobrosMulti` ya fecha por ePayco (`lib/epayco/fecha-cobro-multi-pago.ts`), no por campo manual: el campo ES la referencia ePayco y la cuenta es global, así que solo consulta refs numéricas con `REQUISITO.pagoEpayco`; si no, registro + nota. El bloque empareja fecha por (ref, valor) con multiplicidad, no solo por ref. `FechaDelPago` vive en `bloques/FechaDelPago.tsx`.
