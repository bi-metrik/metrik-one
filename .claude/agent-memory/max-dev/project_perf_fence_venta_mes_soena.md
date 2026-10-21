---
name: project-perf-fence-venta-mes-soena
description: RPC _mes_soena de SOENA — barrera OFFSET 0 (#978/#982 APLICADAS) y pagos por plan genérico de función sql (#1206, migración 20261018190000 SIN aplicar)
metadata:
  type: project
---

PR #978 + #982 (2026-10-01, APLICADAS): barrera `(SELECT * FROM v_venta_mes_comercial WHERE workspace_id = p_workspace_id OFFSET 0)` en las 6 RPC `_mes_soena`. Ventas ~9,7 s -> 0,15 s; pagos sin mejora.

PR #1206 (rama perf/pagos-mes-soena, 2026-10-18, SIN mergear, migración `20261018190000_perf_pagos_mes_soena_plan_custom.sql` SIN aplicar): la causa de pagos era el PLAN GENÉRICO. Una función `LANGUAGE sql` SECURITY DEFINER no se inlinea y en PG 17 planifica con parámetros desconocidos: estima ~1 cobro en el mes y hace nested loop dentro de `v_cobro_valor` (82 vueltas, 5,3 s). Arreglo: plpgsql + `SET plan_cache_mode = force_custom_plan` (~0,15 s). Se agregó `cobro_id` como desempate del ORDER BY: el orden de empates dependía del plan (8 de 11 meses distintos en md5 exacto, conjunto idéntico). El PR trae el DO dry-run con md5 esperados por mes.

**Why:** "la consulta suelta tarda 70 ms y la función 2-5 s" es la firma del plan genérico, no de la vista.

**How to apply:** para medir una función sql por dentro, reproducir con `PREPARE` + `SET LOCAL plan_cache_mode = force_generic_plan` (igual al de la función) vs `force_custom_plan`. Las otras 5 RPC `_mes_soena` son sql con parámetros: candidatas al mismo problema, sin medir. Comparar md5 de funciones en prod con y sin líneas `--` (prod a veces las borra al aplicar).
