---
name: project-columna-pago-cuota-cda
description: Columna Pago de las cuotas CDA en /suscripcion — el pago se empareja a la cuota por FIFO, no por plan+cuota; la UI nunca nombra a Bold
metadata:
  type: project
---

La columna «Pago» de la pestaña Pagos de `/suscripcion` (2026-10-06) muestra fecha · medio del último pago que le abonó a la cuota, emparejado con `ultimoPagoDeCadaCuota` (mismo reparto FIFO de `cuotasConEstado`), NO por `plan_cobro_id` + `numero_cuota`.

**Why:** `mis_cobros_de_servicio()` no devuelve plan ni número de cuota, y hay pagos sueltos del negocio (4D SOFT) que igual cubren cuotas; emparejar por FIFO mantiene «Pagada» y el pago mostrado en la misma cuenta. Sin SQL.

**How to apply:** si un brief pide «05-oct · Bold», el render sale «05/10/2026 · Pago en línea»: `fechaCorta` es dd/mm/aaaa y `etiquetaFuentePago` oculta la pasarela (el test `PROVEEDOR` de suscripcion-render lo exige). Avisarlo, no romper la regla. Si algún día se quiere emparejar por cuota exacta, hay que ampliar la RPC (migración).
