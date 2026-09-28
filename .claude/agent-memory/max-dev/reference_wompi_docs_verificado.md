---
name: wompi-docs-verificado
description: La documentacion publica de Wompi SI responde (antes daba 403) y lo que se verifico ahi el 2026-09-15 sobre tokenizacion, fuentes de pago, transacciones, eventos y anulacion; como leerla desde un worktree aislado
metadata:
  type: reference
---

`docs.wompi.co/docs/colombia/...` respondio 200 el 2026-09-15 (el pendiente del 09-09 decia 403). Se lee
con un script Python de solo biblioteca estandar que baja la pagina con `User-Agent` y extrae el
`<article>` (Write al scratchpad y luego `python3 script.py <url> <ini> <fin>`; un heredoc con logica
lo rechaza el guard). Paginas utiles: `fuentes-de-pago/`, `tokens-de-aceptacion/`, `transacciones/`,
`seguimiento-de-transacciones/`, `eventos/`, `widget-checkout-web/`, `fuentes-de-pago-3ds/`.
⚠️ `consultas-y-operaciones/` es de Pagos a Terceros (payouts), no de cobros.

Verificado (sin llaves, nada probado en vivo):
- Widget con `data-widget-operation="tokenize"` y llave publica: la tarjeta se digita en Wompi, al
  servidor llega un token.
- `POST /v1/payment_sources` con llave privada + `acceptance_token` + `accept_personal_auth` (de
  `GET /merchants/info` con `x-merchant-public-key`). ⚠️ `GET /merchants/:llave` muere el 2026-10-31.
- `POST /v1/transactions` con `payment_source_id`, `reference` unica (duplicada = 422) y firma de
  integridad `SHA256(referencia + monto_centavos + moneda + secreto_integridad)`. Toda transaccion nace
  `PENDING`; finales APPROVED/DECLINED/VOIDED/ERROR; consulta por id solo con llave privada.
- Evento `transaction.updated`: una URL por ambiente, checksum `SHA256(valores de signature.properties +
  timestamp + secreto_eventos)` en `X-Event-Checksum`; las propiedades cambian por evento; reintenta a
  30 min, 3 h y 24 h y para.
- Anulacion `POST /v1/transactions/{id}/void` solo tarjeta y "ciertos estados". NO se encontro reembolso
  por API de una transaccion liquidada. `PUT /v1/payment_sources/{id}/void` documentado para Daviplata y
  boton Bancolombia, no para tarjeta.
- 3DS en fuentes requiere activacion de Wompi; 3RI solo Mastercard; `recurrent` (COF) solo con RBM.

La regla sigue: el cliente HTTP se escribe con las llaves en la mano, no con esto de memoria.
Relacionado: [[spec-modulos-servicios-cobro]].
