/**
 * Que planes de cobro tienen cronograma EXPLICITO (filas en `plan_cobro_cuotas`).
 *
 * La migracion `20260630000001_plan_cobro_cuotas.sql` declara la retrocompat:
 * "un plan SIN filas aqui conserva el comportamiento actual del generador (dia
 * 15, monto uniforme). Solo los planes CON cronograma explicito emiten por
 * fecha/monto exactos." Estaba escrita pero no implementada: el generador
 * uniforme y el paso 1 del cron seguian creando cobros con `plan.monto` y
 * vencimiento uniforme para TODO plan activo.
 *
 * Sobre Trappvel eso significa crear la cuota 6 por $833.333 cuando el contrato
 * dice $833.335 (el ajuste de centavos vive en `plan_cobro_cuotas`), con
 * vencimiento el 15 en vez del 20. Y como la idempotencia es el unique
 * `(plan_cobro_id, numero_cuota)`, gana el que llegue primero: el que corra
 * antes deja clavado su monto y el otro se calla.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** Ids de los planes (de entre `planIds`) que tienen al menos una cuota explicita. */
export async function planesConCronogramaExplicito(
  supabase: SupabaseClient,
  planIds: string[],
): Promise<Set<string>> {
  if (planIds.length === 0) return new Set()
  const { data } = await supabase
    .from('plan_cobro_cuotas')
    .select('plan_cobro_id')
    .in('plan_cobro_id', planIds)
  return new Set(((data ?? []) as { plan_cobro_id: string }[]).map((r) => r.plan_cobro_id))
}

/**
 * Separa los planes en los dos caminos. `uniformes` es lo unico que puede pasar
 * por el generador de periodo; `explicitos` los emite `emitir-cuota-explicita`.
 */
export function particionarPorCronograma<T extends { id: string }>(
  planes: T[],
  idsConCronograma: Iterable<string>,
): { uniformes: T[]; explicitos: T[] } {
  const conCronograma = idsConCronograma instanceof Set
    ? (idsConCronograma as Set<string>)
    : new Set(idsConCronograma)
  const uniformes: T[] = []
  const explicitos: T[] = []
  for (const p of planes) {
    if (conCronograma.has(p.id)) explicitos.push(p)
    else uniformes.push(p)
  }
  return { uniformes, explicitos }
}
