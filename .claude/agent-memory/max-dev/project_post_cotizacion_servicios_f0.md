---
name: post-cotizacion-servicios-f0
description: Post-cotización Trappvel ola 1 (2026-10-12) — Total cobrado, filtro de líneas, F0 servicios del viaje (migración 20261012150000 SIN aplicar, PR 3 apilado)
metadata:
  type: project
---

Ola 1 del plan post-cotización (PR #1108 Total cobrado, #1109 líneas activas, #1111 esquema F0, PR 3 código F0
apilado sobre #1111). Migración `20261012150000_servicios_viaje_esquema` **SIN aplicar**: va ANTES del merge de
#1111 y del PR 3 (que la lee). Interruptor: `lineas_negocio.config_extra.servicios_viaje.activo === true`.

**Why:** Vera (`vera-criterios-post-cotizacion-2026-10-12.md`) es vinculante y cambió el diseño técnico: estado
escrito solo por_reservar/reservado/cancelado (C6), cortesías solo como gasto `cortesia_viaje` (sin tipo
`cortesia` en servicios), comisión mínima (C13), aprobaciones con escritura solo service_role.

**How to apply:**
- Los datos del bloque viajan en `config_extra._servicios` (no por props); solo para la etapa ACTUAL; el
  historial esconde `servicios`.
- El índice único es PARCIAL: PostgREST no puede `onConflict` con él. Por eso la generación lee lo existente e
  inserta; ante 23505 reintenta fila por fila.
- El recargo fijo (línea sin costo, `precio_manual`) también sale como fila «otro» con costo 0 (F0-1 literal):
  F3 tiene que decidir si el gate `servicios_listos` lo ignora o se marca «No va».
- Las premisas Q1/Q3/Q4/Q8 NO se re-midieron (sesión sin MCP de Supabase): pedirlas a la sesión principal.
- PR 1 cambia la import de `saldo-negocio` en `negocio-v2-actions.ts`; PR 3 importa lejos de esa línea para no
  chocar.

Relacionado: [[cotizacion-trappvel]], [[pruebas-por-mutacion]].
