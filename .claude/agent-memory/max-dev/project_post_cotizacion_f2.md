---
name: post-cotizacion-f2
description: Post-cotización Trappvel olas 2 y 3 (2026-10-12) — recordatorios, seguimiento F1, «El cliente confirmó» (#1116) y riel de cobro (#1117 apilado); sin migraciones en la ola 3
metadata:
  type: project
---

Ola 2: #1113 motor de recordatorios, #1114 esquema del plan de pagos, #1115 seguimiento F1; sus 3 migraciones
(20261012160000/170000/180000) ya APLICADAS. Ola 3: #1116 «El cliente confirmó» y #1117 riel de cobro (base
#1116), **sin migración**. Todo detrás de `plan_pagos.activo` (y el recibo de `siigo.recibo_total_automatico`).

**Why:** hallazgos que cambian lo que sigue (Vera manda sobre el diseño técnico):
- `pausado_hasta` no sirve para el toque del aplazamiento: pausa-sla lo borra antes del motor; se lee
  `negocios.metadata.seguimiento.aplazado_para`.
- La traza C1 sin migración: «preparado» vive en `metadata.confirmacion_cliente.mensaje` (texto exacto); el
  WhatsApp que manda la comercial es `avisos_cliente` canal `whatsapp` estado `disparado` motivo `wa_manual`.
- `avisos_cliente.huella` puede no existir en prod: no escribirla.
- `notificaciones.tipo` tiene CHECK: «pagó el anticipo» usa `handoff`; cuotas `cuota_por_vencer`/`cobro_vencido`.
- El recibo pendiente vive en `metadata.recibos_viaje[cobroId]`; el tercero de Siigo sale de
  `metadata.titular_facturacion` solo sin RUT, y hoy le faltan dirección y ciudad (F5 tiene que pedirlas).

**How to apply:**
- #1117 choca con #1115 en `src/lib/recordatorios/{motor,fuentes,reglas}.ts`: conservar las dos fuentes.
- Gates de confirmación y #1115 se insertan en puntos distintos de `cambiarEtapaNegocioConGateSinClave` a propósito.
- Pendientes de Vera: recibo real en Siigo de pruebas (D-1), lectura ≤ 15 s con llave de pruebas (D-8), revisión de
  Emilio y Ren del mensaje, «Así puedes pagar» (PR 7), recargo de pasarela (C8).

Relacionado: [[post-cotizacion-servicios-f0]], [[pruebas-por-mutacion]], [[worktree-aislado-comandos]].
