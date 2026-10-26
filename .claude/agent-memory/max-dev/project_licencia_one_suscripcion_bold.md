---
name: licencia-one-suscripcion-bold
description: 2026-10-05 — /suscripcion abierta a la licencia de ONE (Clarity, módulo business) para cobrar a Termotech con enlace de Bold; el SQL de datos SIN correr; el enlace ya era genérico, lo que faltaba era dónde lo ve el cliente
metadata:
  type: project
---

PR `feat/one-licencia-enlace-bold` (2026-10-05, sin migración). Pedido de Mauricio: cobrar la
suscripción ONE de Termotech (A3 26 2, plan 31d4bc5f…) con enlace de Bold «igual que los CDA».

**Medido: la premisa «el motor solo conoce los slugs de Valida» era falsa.** `generarEnlacePagoCuota`,
el paso 6 del cron y el webhook de Bold no miran slug ni módulo: piden un contrato en
`servicios_contratados` + plan con pasarela en línea. Lo Valida-only era `/suscripcion`
(`entradaValidaCda` + ruta en `MODULOS.valida.rutas` + menú con `valida_consulta`). El catálogo YA
tenía la ficha `licencia-clarity` (módulo `business`), que nombra a Termotech: no hizo falta `one-licencia`.

**Why:** abrir la sección a Clarity es el mínimo para que el cliente vea el enlace.

**How to apply:**
- ⚠️⚠️ `sql/one-licencia/2026-10-05_termotech-contrato-y-enlace-bold.sql` SIN correr. Va DESPUÉS
  del deploy. Pone el plan en `bold` y `activo=false` (si no, el 10-oct el cron emite cuenta de cobro de
  persona natural por la misma cuota 2): eso es decisión de Mauricio sobre quién factura.
- ⚠️ La cuota 1 de Termotech NO tenía fila en `plan_cobro_cuotas` a propósito (el emisor no valida
  pagos). Con el reparto FIFO eso le abona el pago de septiembre a la cuota 2 y el enlace sale
  «ya cubierta». El SQL la crea. Cualquier plan que «omita la cuota pagada» tiene el mismo defecto.
- Contrato `one` entra con términos en `aprobada` = «no hay documento que aceptar»
  (`terminos-adhesion-one@1.0` no está publicado). Publicarlo obliga a cambiar `entrada-servidor.ts`.
- ONE no se pausa por mora: >30 días sigue «Cuota vencida» (`resumenEstado` con `producto: 'one'`).
- El layout ahora corre `menuSuscripcion` también para espacios `business`: una RPC `mis_servicios`
  más por navegación en todo Clarity (SOENA incluida).

Relacionado: [[project-enlace-pago-automatico]], [[pago-en-linea-bold]], [[project-suscripcion-solo-designado]].
