/**
 * La renovación continua de un cobro por ciclo: cuándo un plan recibe su cuota SIGUIENTE y con qué
 * fecha, periodo y monto. **Puro.**
 *
 * Decisión de Mauricio del 2026-10-09 (fila A de
 * `proyectos/metrik/valida/docs/crecimiento-mrr/10-decisiones-mauricio.md`): el cobro de Valida «se
 * renueva solo» cada mes, sin permanencia, y el cliente se retira cuando quiera. Hasta este archivo
 * nada en ONE renovaba: `planes_cobro.auto_renovar` solo lo leía el trigger que apaga el plan al
 * pagarse la última cuota, y un plan llegaba a su cuota N y se quedaba sin cuotas.
 *
 * ## Renovar es agregar UNA cuota, nunca un año
 *
 * Sin permanencia, el calendario no debe mostrar un compromiso que el cliente no hizo. Este eslabón
 * agrega la cuota siguiente cuando la última del plan vence dentro de `HORIZONTE_RENOVACION_DIAS`, y
 * solo esa: en régimen, el plan tiene siempre UNA cuota futura. El paso 6 del cron le genera el
 * enlace siete días antes del vencimiento (`DIAS_ANTICIPACION_ENLACE`), así que el horizonte deja
 * más de tres semanas de margen aunque el cron deje de correr unos días.
 *
 * ## Las barreras, todas del lado de NO cobrar
 *
 *   1. **Módulo en la lista** (`MODULOS_CON_RENOVACION_AUTOMATICA`, hoy solo `valida_consulta`) y
 *      **`auto_renovar = true` en el plan**: el plan es el consentimiento. Dar de baja a un cliente
 *      es apagar ese interruptor (y terminar el contrato).
 *   2. **Contrato `activo`.** Pausado (por mora), cancelado o terminado no renuevan.
 *   3. **`vigente_hasta` del contrato**: el periodo que arrancaría después de esa fecha no se crea.
 *      Es la baja con fecha.
 *   4. **Mora**: una cuota vencida hace más de `DIAS_GRACIA_RENOVACION` días sin pagar frena la
 *      renovación. No se le sigue sumando deuda a quien no paga; eso lo decide una persona.
 *   5. **Plan anual en curso**: el prepago anual cubre el periodo; la cuota mensual sería doble cobro.
 *   6. **Nunca una cuota vencida al nacer**: si la siguiente ya venció (el cron estuvo caído más que
 *      el horizonte, o el plan se dejó morir), no se recupera sola. Cobrar meses atrasados es una
 *      decisión, no un efecto del cron.
 *   7. **El calendario tiene que cuadrar**: el periodo que el concepto de la última cuota dice pagar
 *      tiene que ser el que se deduce de `fecha_inicio`. Si no, una persona lo mira.
 */

import { diaMes, sumarDias, sumarMeses } from './enrolar-ciclo'
import { leerPeriodoEnConcepto, quitarPeriodo } from './periodo-en-concepto'

/** Los módulos cuyo cobro por ciclo se renueva solo. Sumar uno es una decisión de Mauricio. */
export const MODULOS_CON_RENOVACION_AUTOMATICA = ['valida_consulta'] as const

/** La cuota siguiente se crea cuando la última vence dentro de estos días. */
export const HORIZONTE_RENOVACION_DIAS = 30

/** Una cuota vencida hace más de estos días sin pagar frena la renovación. La gracia de la mora. */
export const DIAS_GRACIA_RENOVACION = 5

/** Tipo de las cuotas de la serie mensual. Las demás (anticipo, usuarios adicionales) no se renuevan. */
export const TIPO_CUOTA_SERIE = 'cuota'

export function esModuloConRenovacion(modulo: string | null | undefined): boolean {
  return !!modulo && (MODULOS_CON_RENOVACION_AUTOMATICA as readonly string[]).includes(modulo)
}

export interface CuotaDelPlan {
  numero: number
  tipo: string
  monto: number
  fecha_vencimiento: string
  concepto_detalle: string | null
  /** Hay un cobro de esta cuota con fecha y sin anular. */
  pagada: boolean
}

export interface PlanCandidatoRenovacion {
  planId: string
  frecuencia: string
  fechaInicio: string
  fechaFin: string
  totalCuotas: number
  autoRenovar: boolean
  conceptoTemplate: string | null
  /** Módulo del catálogo del contrato que manda en el negocio. `null` = no hay contrato. */
  modulo: string | null
  contratoEstado: string | null
  /** `servicios_contratados.parametros`: el precio pactado sale de aquí, no del plan. */
  parametros: Record<string, unknown> | null
  vigenteHasta: string | null
  planAnualEnCurso: boolean
  /** El negocio tiene más de un plan con `auto_renovar`: no se sabe cuál renovar. */
  variosPlanes: boolean
  cuotas: CuotaDelPlan[]
}

export interface CuotaNueva {
  numero: number
  tipo: typeof TIPO_CUOTA_SERIE
  monto: number
  fecha_vencimiento: string
  concepto_detalle: string
}

export type MotivoNoRenovar =
  | 'modulo_no_automatico'
  | 'sin_auto_renovar'
  | 'estado'
  | 'varios_planes'
  | 'frecuencia'
  | 'plan_anual'
  | 'sin_cuotas'
  | 'horizonte_cubierto'
  | 'en_mora'
  | 'sin_precio'
  | 'vigencia_terminada'
  | 'siguiente_vencida'
  | 'calendario_irregular'

export type PlanRenovacion =
  | { tipo: 'renovar'; cuota: CuotaNueva; totalCuotas: number; fechaFin: string }
  | { tipo: 'no'; motivo: MotivoNoRenovar }

function entero(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.trunc(n) : null
}

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/**
 * El mes del calendario del plan en que cae una fecha: el `m` tal que el periodo
 * `[fechaInicio + m meses, fechaInicio + (m+1) meses)` la contiene.
 */
export function mesDelPlan(fechaInicio: string, fecha: string): number {
  let m = 0
  while (m < 1200 && sumarMeses(fechaInicio, m + 1) <= fecha) m++
  return m
}

/**
 * ¿Este plan recibe hoy su cuota siguiente? Un motivo por cada «no», para que el cron los cuente.
 *
 * El periodo de la cuota nueva sale de `fecha_inicio` (el mes m del plan va del día de inicio al día
 * anterior un mes después) y su vencimiento conserva el desfase que traía la última cuota dentro de
 * su periodo: los CDA vencen el 27 de un periodo que arranca el 23 (cláusula SEXTA), los enrolados
 * por trial vencen el primer día del periodo. Así la serie sigue igual que la cargaron.
 */
export function planearRenovacion(p: PlanCandidatoRenovacion, hoy: string): PlanRenovacion {
  if (!esModuloConRenovacion(p.modulo)) return { tipo: 'no', motivo: 'modulo_no_automatico' }
  if (!p.autoRenovar) return { tipo: 'no', motivo: 'sin_auto_renovar' }
  if (p.contratoEstado !== 'activo') return { tipo: 'no', motivo: 'estado' }
  if (p.variosPlanes) return { tipo: 'no', motivo: 'varios_planes' }
  if (p.frecuencia !== 'mensual') return { tipo: 'no', motivo: 'frecuencia' }
  if (p.planAnualEnCurso) return { tipo: 'no', motivo: 'plan_anual' }

  const serie = p.cuotas
    .filter((c) => c.tipo === TIPO_CUOTA_SERIE)
    .sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))
  if (serie.length === 0) return { tipo: 'no', motivo: 'sin_cuotas' }
  const ultima = serie[serie.length - 1]

  if (ultima.fecha_vencimiento >= sumarDias(hoy, HORIZONTE_RENOVACION_DIAS)) {
    return { tipo: 'no', motivo: 'horizonte_cubierto' }
  }

  const limiteMora = sumarDias(hoy, -DIAS_GRACIA_RENOVACION)
  if (serie.some((c) => !c.pagada && c.fecha_vencimiento < limiteMora)) return { tipo: 'no', motivo: 'en_mora' }

  const monto = entero(p.parametros?.precio_mensual)
  if (monto === null || monto <= 0) return { tipo: 'no', motivo: 'sin_precio' }

  // El calendario de la última cuota: su mes del plan y el desfase del vencimiento dentro de él.
  const mUltima = mesDelPlan(p.fechaInicio, ultima.fecha_vencimiento)
  const inicioUltima = sumarMeses(p.fechaInicio, mUltima)
  const desfase = diasEntre(inicioUltima, ultima.fecha_vencimiento)
  const periodoUltima = leerPeriodoEnConcepto(ultima.concepto_detalle, ultima.fecha_vencimiento)
  // La cuota 1 de los CDA vence el 30-sep con periodo del 23-sep: el desfase es 7 ahí y 4 en las
  // demás. Por eso se exige el periodo del CONCEPTO de la última cuota, que es lo que el cliente ve,
  // y no se infiere de la serie.
  if (periodoUltima && periodoUltima.desde && periodoUltima.desde !== inicioUltima) {
    return { tipo: 'no', motivo: 'calendario_irregular' }
  }

  const desde = sumarMeses(p.fechaInicio, mUltima + 1)
  const hasta = sumarDias(sumarMeses(p.fechaInicio, mUltima + 2), -1)
  const vence = sumarDias(desde, desfase)
  // El desfase sale de una cuota real; si lo saca del periodo siguiente, el calendario no es mensual.
  if (vence >= sumarMeses(p.fechaInicio, mUltima + 2)) return { tipo: 'no', motivo: 'calendario_irregular' }

  if (p.vigenteHasta && desde > p.vigenteHasta) return { tipo: 'no', motivo: 'vigencia_terminada' }
  if (vence < hoy) return { tipo: 'no', motivo: 'siguiente_vencida' }

  const base =
    (ultima.concepto_detalle && quitarPeriodo(ultima.concepto_detalle).trim()) ||
    p.conceptoTemplate?.trim() ||
    'Suscripción'
  const numero = Math.max(0, ...p.cuotas.map((c) => c.numero)) + 1

  return {
    tipo: 'renovar',
    cuota: {
      numero,
      tipo: TIPO_CUOTA_SERIE,
      monto,
      fecha_vencimiento: vence,
      concepto_detalle: `${base} · periodo del ${diaMes(desde)} al ${diaMes(hasta)}`,
    },
    totalCuotas: Math.max(p.totalCuotas, numero),
    fechaFin: hasta > p.fechaFin ? hasta : p.fechaFin,
  }
}
