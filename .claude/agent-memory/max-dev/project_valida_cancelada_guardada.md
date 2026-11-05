---
name: valida-cancelada-guardada
description: PR B de Suspendida/Cancelada de los CDA (4-nov) — Cancelada guardada en el contrato, cuotas anuladas por la 2.5, reactivación con plan nuevo y corte por época; migración 20261104233000 SIN aplicar
metadata:
  type: project
---

PR B del diseño `proyectos/metrik/valida/docs/legal/2026-11-04_diseno-suspendido-cancelado.md` (rama
`feat/valida-cancelada-11-3`). Debe estar en producción el 30-dic-2026: la primera Cancelada es el 31-dic (11.7).

- **Migración 20261104233000 SIN aplicar (4-nov):** columnas `servicios_contratados.cancelada_desde`, `reactivada_desde`,
  `reactivacion_cobro_id`; `plan_cobro_cuotas.anulada_at`/`anulacion_motivo`; y las RPC `mis_servicios`,
  `mis_cuotas_de_servicio`, `mis_cobros_de_servicio` con columnas nuevas (DROP+CREATE, guarda que exige el ancla
  de 20261016100100 en la definición viva). **Va ANTES del merge**: el paso 6 (enlaces), el botón de enlace y el
  8d/8e leen esas columnas directo; sin ellas el cron de cobro falla para TODOS los planes.
- **Época:** desde `reactivada_desde`, todo lector de cuotas/cobros de un CDA separa con `separarPorEpoca`
  (`cancelada.ts`). Si agregas un lector nuevo de cuotas FIFO de un negocio CDA, pásalo por ahí, o el pago de la
  reactivación tapará la cartera vieja (pasó con `generarEnlacePagoCuota`, que repartía por negocio).
- `terminado` nunca es automático (Emilio): solo a mano con motivo. La puerta ya niega `sin_contrato_vigente`.
- Cartera = solo períodos antes del 1-dic; enlace + correo genérico de cuota cada 30 días (`DIAS_ENTRE_ENLACES_CARTERA`).
- 11-ene-2027 es festivo (Reyes): las pruebas de enlaces con fechas de enero tropiezan con `dia_no_habil_CO`.

**Why:** la Cancelada como cálculo no podía cumplir a la vez la 2.5 (no cobrar) y la 11.4 (fecha nueva).
**How to apply:** antes de tocar cobro/mora de Valida CDA, mirar `cancelada.ts` y su encabezado. Relacionado:
[[valida-reverso-corta-plan]], [[valida-renovacion-continua]].
