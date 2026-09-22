---
name: factura-libre-abono
description: "PR #818 (2026-09-22, SIN mergear): la factura ya no espera el recaudo y el honorario se ABONA a ella (RC-1 DebtPayment). SQL de config SOENA SIN aplicar; el vencimiento sale del NOMBRE de la factura, no de su `prefix`; nunca se probó un POST"
metadata:
  type: project
---

PR **[#818](https://github.com/bi-metrik/metrik-one/pull/818)**, rama `feat/factura-libre-abono-automatico`,
commit de código `9bd971e7`. **Sin mergear** al cerrar: la sesión principal decide.

**Why:** decisión de Mauricio del 2026-09-22. Si la factura sale antes del pago (a crédito,
forma 1055), la cuenta por cobrar tiene que cerrarse sola cuando el cliente paga; si el
honorario sigue saliendo como anticipo suelto, la factura queda abierta para siempre.
Revierte el gate de [[gate-recaudo-facturacion]] (#578/#581): ya no existen
`estadoDeRecaudo`, la banda del 1% ni la sección de retenidos.

## How to apply

- ⚠️ **SQL SIN aplicar:** `sql/soena/2026-09-22_honorario-se-abona-a-la-factura.sql` agrega
  `tipo: 'abono'` al componente honorario de `recibo_por_concepto`. Seguro antes o después
  del deploy, pero pegado: sin él, una factura emitida sale sin abonos.
- ⚠️⚠️ **El `prefix` de la factura NO es el del vencimiento.** GET a FV-2-540: `prefix: "SOE"`
  (resolución DIAN), `name: "FV-2-540"`. Los abonos manuales cruzan `due.prefix: "FV-2"`. Se
  arma del nombre con `^([A-Za-z]+-\d+)-(\d+)$` (`abono.ts`). `due.date` es el `due_date` de
  la cuota, no la fecha del documento (RC-1-33 cruza FV-1-6 del 2025-03-07 con due 2025-12-22).
- **Tope = `balance` del GET de la factura**, no una resta en ONE: el saldo de Siigo ya
  descuenta lo que Tesorería cruzó a mano.
- **Entradas «a mano»** (retención, factura saldada/anulada/con cuotas/de otro tercero/sin
  vínculo) viven en la MISMA lista `cobros.siigo_recibo` pero **sin `numero`**: `recibosDelCobro`
  las ignora por construcción. Se escriben con `conEntradaDeComponente`, que conserva lo de otros
  componentes; reconstruir la lista con `recibosDelCobro` las borraría.
- ⚠️ **El guardián de duplicados del abono excluye los recibos que ONE ya le conoce al negocio.**
  El plan 50/50 produce dos abonos del MISMO valor contra la misma factura: sin eso el segundo
  pediría justificación siempre. El anticipo NO tiene esa exclusión (comportamiento previo).
- `recibo_automatico` sigue en `false`: los abonos de pagos NUEVOS salen desde Tesorería; el
  abono al FACTURAR sí sale solo (`abonos-factura.ts`, sin aviso al cliente, nunca lanza).
- **Nunca se hizo un POST a Siigo.** Sin verificar: si Siigo acepta un abono fechado antes de su
  factura (los 8 manuales son todos posteriores). Se implementó el reintento con la fecha de la
  factura ante un 4xx, con la misma clave de idempotencia.
- **Abierto:** adoptar una factura existente NO dispara el abono de los pagos previos.
- Medido el 2026-09-22 en SOENA: 65 cobros con honorario sin acusar (34 facturados con
  `siigo_id`, 31 sin factura), 1 con RC-1 de honorario como anticipo (V0502), 0 con retención.

## Cómo se midió sin escribir

`GET` al Siigo real con un `tsx` temporal en `scripts/` que importa `siigoRequest` (symlink de
`node_modules` y `.env.local`, borrados después). `/v1/invoices?name=FV-1-6` sí filtra por
nombre. La doc de la API vive en `developers.siigo.com/docs/siigoapi/voucher/1-create-voucher/`
y `…/invoice/4-get-invoice/` (Apiary da 502).

Relacionado: [[recibo-por-concepto]], [[gate-recaudo-facturacion]], [[pruebas-por-mutacion]],
[[arbol-limpio-por-tarball]].
