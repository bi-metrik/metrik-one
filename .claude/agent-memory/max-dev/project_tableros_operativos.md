---
name: tableros-operativos
description: Bandejas de pendientes por fase en /tableros (#939), opt-in por config_extra.tableros_operativos; inerte hasta que Mauricio encienda el flag en metrik; filas que quedaron fuera por falta de dato
metadata:
  type: project
---

PR #939 (2026-09-28): en un workspace con `config_extra.tableros_operativos = true`, las
pestanas genericas comercial/operativo/financiero pasan a bandejas de pendientes por fase
(venta / ejecucion / cobro + gastos). Logica pura en `src/lib/tableros/bandejas.ts`.
**Inerte hasta que se escriba el flag** (SQL en la descripcion del PR); sin migracion.

**Why:** Mauricio pidio que Tableros responda "que hago hoy", no que reporte. Piloto solo en metrik.

**How to apply:**
- "Sin movimiento" = ultima fila de `activity_log` CON autor; metrik casi no tiene
  activity_log (41 filas), asi que el respaldo `etapa_cambiada_at`/`created_at` decide casi
  todo: toda la ejecucion salio como "sin avance". Es verdad (nadie registra avance en ONE).
- Quedaron fuera por falta de dato: propuesta enviada sin respuesta (metrik no envia
  cotizaciones por ONE), entregas/etapa terminada (Ejecucion de metrik no tiene bloques),
  pago sin conciliar (no hay extracto), gasto fuera de lo normal, gasto de la app sin soporte
  (la app no marca `soporte_pendiente`; solo el bot lo hace).
- La tasa de cierre cuenta como ganados los CDA que nacen en Cobro: se infla.
- ⚠️ La Management API en modo `read_only: true` no puede ejecutar `hoy_bogota()` (42501):
  para leer `v_cartera_negocio` hay que replicar la vista con `(now() at time zone 'America/Bogota')::date`.
  Quitar `read_only` lo bloquea el clasificador; no insistir.

Relacionado: [[cartera-vencido-por-cuota]], [[medir-antes-de-construir]].
