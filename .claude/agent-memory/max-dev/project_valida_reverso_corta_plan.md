---
name: project-valida-reverso-corta-plan
description: Reverso del pago de un ciclo de Valida autogestionada corta el plan en el acto (decisión 2026-10-27); estado en valida_plan.reversado.corte, reactivación por cobro sin plan, correo retenido en prod hasta Vera
metadata:
  type: project
---

PR feat/valida-reverso-anula-ciclo (27-oct): el reverso del pago que abrió el ciclo vigente llama
`POST /autogestion/{cliente}/ciclos/anular` (metrik-valida#82, mergear Valida PRIMERO). Sin migración: el estado
vive en `config_extra.valida_plan.reversado.corte` (pendiente/anulado/no_aplica/final) y `recobro_cobro_id`.

**Why:** decisión de Mauricio con condiciones de Emilio: un reverso de un cobro duplicado/indebido hecho por
MéTRIK NO corta. «Otro pago válido» = FIFO sigue cubriendo la cuota, o un evento «posible doble pago» sin reverso
(`FRASE_DOBLE_PAGO` en pago-en-linea.ts: si cambia el texto, cambia la detección).

**How to apply:**
- Pagar de nuevo el período NO puede usar el cobro de la cuota: la llave única (plan_cobro_id, numero_cuota) la
  tiene el anulado y su referencia one-ciclo quedó anulada en Valida para siempre. Por eso la reactivación es un
  cobro programado SIN plan ni cuota (`reactivacion-servidor.ts`); el emisor de facturas (fuera del repo) no se
  verificó con un cobro sin plan.
- Correo al cliente detrás de `AVISO_REVERSO_CLIENTE_APROBADO=false` (prod lo retiene; preview lo manda). Solo el
  mismo día de Bogotá del corte; después queda `vencido`.
- 7b NO carga la tarjeta mientras `corteVigente` (pendiente/anulado), ni la reversada ni la siguiente (Mik,
  27-oct: invita otro contracargo). OJO: el `pagadas` de 7b sigue contando el anulado con `fecha` como pagado;
  lo que lo frena es la guarda por plan. La mora/Pagos (FIFO, `mis_cobros_de_servicio`) ya lo cuenta no pagado.
- Ver [[project-epayco-reversos]].
