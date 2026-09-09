/**
 * Fecha de cada cuota de un plan de cobro. Fuente ÚNICA.
 *
 * Vivía dentro del cron `procesar-planes-cobro` (paso 1, cobros T+3). El ciclo de
 * suscripciones (`src/lib/suscripciones/ciclo.ts`) necesita la MISMA respuesta para el
 * MISMO plan: los dos escriben en `cobros` bajo el unique `(plan_cobro_id, numero_cuota)`,
 * y si calcularan la fecha distinto ganaría el que insertara primero y el otro se
 * callaría —el fallo mudo que ya costó la cuota 6 de Trappvel (ver
 * `cronograma-explicito.ts`). Una sola función, dos consumidores.
 *
 * ⚠️ Semántica heredada, a propósito intacta: `addMeses` usa `Date.setMonth`, que
 * DESBORDA cuando el día no existe en el mes destino (31 de enero + 1 mes = 3 de
 * marzo). Ningún plan vivo arranca el 29, 30 ni 31 (medido el 2026-09-08: días 5, 10,
 * 15, 20, 26 y 27), así que hoy no muerde. Cambiarlo es cambiar la fecha de cuotas ya
 * emitidas, no un arreglo de este módulo.
 */

import { todayBogotaISO } from '@/lib/dates/bogota'

export type FrecuenciaPlan = 'mensual' | 'trimestral' | 'anual'

export interface PlanParaCuotas {
  fecha_inicio: string
  frecuencia: FrecuenciaPlan | string
  total_cuotas: number
}

export function addMeses(fecha: Date, meses: number): Date {
  const d = new Date(fecha)
  d.setMonth(d.getMonth() + meses)
  return d
}

/**
 * Instante de la cuota `numeroCuota` (1..N). `fecha_inicio` se lee como día
 * calendario Bogotá: 05:00 UTC = 00:00 Bogotá.
 */
export function fechaCuota(fechaInicio: string, frecuencia: string, numeroCuota: number): Date {
  const inicio = new Date(`${fechaInicio}T05:00:00Z`)
  const offset = numeroCuota - 1
  switch (frecuencia) {
    case 'mensual':     return addMeses(inicio, offset)
    case 'trimestral':  return addMeses(inicio, offset * 3)
    case 'anual':       return addMeses(inicio, offset * 12)
    default:            return inicio
  }
}

/** La misma cuota, como 'YYYY-MM-DD' en Bogotá. */
export function fechaCuotaISO(fechaInicio: string, frecuencia: string, numeroCuota: number): string {
  return todayBogotaISO(fechaCuota(fechaInicio, frecuencia, numeroCuota))
}

export interface CuotaDelPlan {
  numero: number
  fechaEsperada: string
  esUltima: boolean
}

/**
 * La primera cuota del plan cuya fecha es `>= fechaISO`. Es la que una suscripción
 * con `proximo_cobro = fechaISO` tiene que cobrar. `null` si el plan ya no tiene
 * cuotas de esa fecha en adelante (terminó).
 *
 * Se busca por `>=` y no por igualdad: si `proximo_cobro` se escribió a mano con
 * un día distinto al de la cuota, igual se resuelve a una cuota real del plan en
 * vez de a ninguna.
 */
export function cuotaParaFecha(plan: PlanParaCuotas, fechaISO: string): CuotaDelPlan | null {
  const total = Math.max(0, Math.floor(plan.total_cuotas))
  for (let n = 1; n <= total; n++) {
    const f = fechaCuotaISO(plan.fecha_inicio, plan.frecuencia, n)
    if (f >= fechaISO) return { numero: n, fechaEsperada: f, esUltima: n === total }
  }
  return null
}

/** La cuota que sigue a `numero`, o `null` si era la última. */
export function cuotaSiguiente(plan: PlanParaCuotas, numero: number): CuotaDelPlan | null {
  const total = Math.max(0, Math.floor(plan.total_cuotas))
  const n = numero + 1
  if (n > total) return null
  return { numero: n, fechaEsperada: fechaCuotaISO(plan.fecha_inicio, plan.frecuencia, n), esUltima: n === total }
}

/** Días calendario entre dos 'YYYY-MM-DD' (positivo si `hasta` es después). */
export function diasEntreISO(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`)
  const b = Date.parse(`${hasta}T00:00:00Z`)
  return Math.round((b - a) / 86400000)
}
