---
name: valida-16-4-venta-periodo
description: Regla 16.4 al vender un período (Emilio 5-nov): sin v1.5 aceptada no se ofrece período con inicio ≥ base; dónde corta, qué no es Cancelada, gotchas
metadata:
  type: project
---

PR de la regla de Emilio del 5-nov (rama `feat/valida-16-4-no-vender-periodo`, sin migración). Plazo duro: en
producción antes del sáb 19-dic-2026 (cuota 4 de Maxitec, 23-dic–22-ene).

- **Un período se vende** si su inicio < base, o si la v1.5 se aceptó a más tardar el día en que empieza
  (`periodoSeVende`). Aceptar después del inicio NO lo vende: vuelve a empezar por la reactivación (plan nuevo).
- **Base** = fecha de la 16.4 del TEXTO registrado (`datosDelTextoV15().exigeDesde`), nunca `terminos_plazo_hasta`.
  Aceptación por servicio = `aceptaciones_terminos` con `documento_sha256` = PDF de la v1.5 + `negocio_id` del contrato.
- **Corte único del enlace**: `generarEnlacePagoCuota` (cron, botón, «Pagar el mes» pasan por ahí). Renovación:
  motivo `v15_sin_aceptar`. Plan anual: motivo `acepta_v15` (Maxitec tiene `plan_anual_habilitado`).
- **No es la cláusula 11**: `leerCuentaCda` y `cuentaDelContrato(db, sc, venta)` sacan lo no vendido de `cuotas`
  (va en `noVendidas`). 8e calcula la anulación 2.5 sobre `cuotas + noVendidas`.
- **Gotcha de pruebas**: `puerta.test.ts` mockea `todayBogotaISO` a `escenario.hoy` ignorando el argumento; por eso
  `diaBogota` resta 5 h a mano. No usar `todayBogotaISO(new Date(x))` para convertir instantes en código que esa
  prueba recorre.
- **Gotcha existente arreglado de paso**: después de una reactivación `reactivacion_cobro_id` queda con el cobro
  pagado; una segunda Cancelada habría dicho «Ya recibimos el pago» y el paso 0 del 8e la habría reactivado con
  el pago viejo. Ahora «ya usado» = `reactivada_desde === cobro.fecha`.
- El 20-dic-2026 y el 16-ene-2027 no son días hábiles para el enlace (domingo y sábado): el cron genera el primer hábil.

**Why:** Emilio: mientras el CDA pague, sin esta regla la 16.4 nunca se exige.
**How to apply:** cualquier camino nuevo que venda un período de Valida CDA (otro botón, otro producto anual) tiene
que preguntar a `periodoSeVende` / `ventaV15DelContrato`. Relacionado: [[valida-cancelada-reactivacion]].
