---
name: acuses-resend-avisos-cliente
description: PR #596 sin mergear — el orden de despliegue no es negociable, `rebotado` queda invisible en el producto, y `suppressed` es un hueco abierto
metadata:
  type: project
---

# `avisos_cliente` y los acuses de Resend (PR #596, 2026-09-09)

`notificar-etapa` marca `estado = 'enviado'` en cuanto Resend acepta el POST. El rebote llega
**despues**, por el webhook de acuses, y no habia webhook: la tabla que existe para responder
"¿a este cliente le avisamos?" respondia que si sobre clientes a los que nadie les aviso.
Medido en SOENA el 2026-09-09: 61 avisos por correo desde el 1-sep (51 `enviado` con
`proveedor_id`, 10 `omitido`), tres de los 51 rebotados y los tres diciendo `enviado`.

**Why:** el PR construye la vuelta (migracion + edge function `resend-webhook` + backfill), pero
queda **sin mergear, sin desplegar y sin registrar en Resend**. Nada de esto esta vivo.

**How to apply:**

## ⚠️ El orden de despliegue no es negociable

1. **Migracion** `20260909000001_avisos_cliente_acuses_resend.sql`.
2. **Deploy de la edge function** (mergear a `main` NO despliega edge functions).
3. Secreto `RESEND_WEBHOOK_SECRET` en los secretos de la edge function.
4. Registrar el endpoint en el panel de Resend con los tres eventos.
5. Backfill opcional, primero sin `--commit`.

Al reves: el webhook escribe `rebotado` contra un CHECK que lo rechaza (23514) o `entregado_at`
contra una columna que no existe (42703), devuelve 5xx, y **Svix reintenta 10 horas por cada
acuse y despues Resend deshabilita el endpoint**. Comprobado contra produccion: hoy la consulta
del backfill devuelve `42703: column avisos_cliente.entregado_at does not exist`.

## ⚠️ `rebotado` va a quedar correcto en la tabla e INVISIBLE en el producto

Nada en `src/` lee `avisos_cliente` — la escriben `notificar-etapa` y las migraciones, y nadie
la muestra. El estado nuevo no aparece en ninguna pantalla hasta que alguien construya la vista.
Es el limite del PR, no un olvido.

## ⚠️ `suppressed` es un hueco abierto, no cerrado

Resend tiene `last_event = 'suppressed'`: acepta el POST y **no envia nada** porque la direccion
esta en su lista de supresion. Esa fila dice `enviado` sobre un correo que no salio — el mismo
defecto que el PR cierra, entrando por otra puerta. **No se mapeo a proposito**: el vocabulario
de `estado` no tiene un lugar para eso y elegirle uno a ojo seria inventar. El backfill lo cuenta
aparte para que la decision se tome con el numero delante. Sin decidir.

## Lo que el backfill NO puede saber (tres limites de la API, verificados)

`GET /emails/{id}` devuelve **solo `last_event`**:

- **No la fecha del evento** → `entregado_at`/`queja_at` reconstruidos llevan la fecha del ENVIO
  como cota inferior. Las filas que escriba el webhook si llevan la real.
- **No la historia** → un correo entregado y luego marcado como spam solo dice `complained`: su
  `entregado_at` no se puede reponer nunca.
- **No el diagnostico del rebote** → el motivo reconstruido empieza por `rebote:` y el del
  webhook por `rebote_permanente:` / `rebote_transitorio:`. Se distinguen a simple vista a
  proposito.

El backfill exige `RESEND_API_KEY`, que **no esta en el `.env.local` del repo** (vive en los
secretos de la edge function y en Vercel).

## Dos decisiones que no se revierten

- **`rebotado` y no `fallido`.** `fallido` = el proveedor rechazo el POST (trabajo nuestro);
  `rebotado` = el correo salio y el buzon lo devolvio (trabajo del equipo: corregir la
  direccion). La migracion original ya declaraba esa distincion.
- **La entrega y la queja son columnas, no estados.** `entregado_at` puede convivir con
  `estado = 'rebotado'` (el servidor acepto, el buzon devolvio despues), y una queja **no** baja
  el estado porque el correo si llego. Ademas es lo que hace que el orden de llegada no importe:
  ningun acuse escribe una columna que otro acuse tambien escriba, asi que la idempotencia vive
  en el `WHERE` y no en un `if`.

Mecanica de la firma en [[firma-svix-resend]]. La tabla nacio en la migracion
`20260901000003_avisos_cliente_traza.sql`, cuyo encabezado es la mejor descripcion de para que
existe cada columna.
