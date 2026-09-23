---
name: project-enlace-pago-automatico
description: 2026-09-23 — paso 6 del cron procesar-planes-cobro genera solo el enlace de pago de las cuotas de los CDA (7 días antes) y avisa por correo a la designada; ignora planes_cobro.activo a propósito
metadata:
  type: project
---

El cron diario `procesar-planes-cobro` tiene un paso 6 (`src/lib/cobros/enlace-automatico-servidor.ts`,
selección pura en `enlace-automatico.ts`): cuota de contrato de servicio (`servicios_contratados` activo o
pausado) con pasarela en línea real, que vence en ≤7 días o ya venció sin pagar y sin enlace vigente →
`generarEnlacePagoCuota` (la función del botón) + correo a `aceptante_designado_id` con botón a
`https://<slug>.metrikone.co/suscripcion` + fila en `avisos_cliente` + `activity_log` «automáticamente».

**Why:** Mauricio pidió que nadie tenga que oprimir «Generar enlace de pago». Sin migración.

**How to apply:**
- ⚠️ **No mira `planes_cobro.activo`**: ese es el interruptor del EMISOR de cuentas (`emitirCuentasExplicitasPeriodo`
  solo lee planes activos). El plan de cda-pruebas (`f37e3d1a…`) está inactivo para que el emisor no le emita y
  aun así recibe enlace. Apagar el enlace automático de un CDA = poner el contrato en `terminado`/`cancelado`, o
  quitar la pasarela en línea.
- El correo sale SOLO cuando la corrida generó el enlace; un aviso `fallido` no se reintenta (el enlace queda
  vigente). Un correo por enlace, llave de idempotencia `enlace-cuota-<cobro>-<expira>` también en Resend.
- El guardado del enlace tiene guarda CAS sobre `enlace_pago_url`: si dos procesos generan a la vez, el segundo
  devuelve error y no avisa (la pasarela sí creó un enlace huérfano; queda en el mensaje).
- Medido en prod al abrirlo: solo existe UN plan con contrato (cda-pruebas); 4D SOFT tiene contrato sin plan.
  Cuota 1 de cda-pruebas tiene enlace hasta 2026-09-30 13:20 UTC → el primer enlace automático sale el 2026-10-01.
- Doble reutilizable que lee y escribe (update con filtros, range, DEFAULT de `cobros.fecha`): `test/tablas-doble.ts`.

Relacionado: [[pago-en-linea-bold]], [[project-suscripcion-solo-designado]], [[idempotencia-cuentas-cobro]].
