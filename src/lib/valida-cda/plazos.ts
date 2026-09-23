/**
 * Las dos fechas que deciden si un CDA opera Valida, además de la aceptación de sus términos. Puro:
 * todas las fechas son 'YYYY-MM-DD' de Bogotá y `hoy` entra por parámetro.
 *
 * ## 1. El plazo para aceptar los términos (decisión de Mauricio, 2026-09-23)
 *
 * `servicios_contratados.terminos_plazo_hasta` es el ÚLTIMO día en que el espacio opera sin la
 * aceptación. Con plazo 30-sep: el 30-sep opera (con aviso), el 1-oct se pausa. `null` = sin plazo:
 * se pausa desde que existe el contrato (el comportamiento del PR #845).
 *
 * ## 2. La mora (cláusula 11.1 de los términos)
 *
 * «METRIK podrá suspender el Servicio cuando existan obligaciones económicas vencidas superiores a
 * treinta (30) días calendario». Se mide sobre la cuota impaga MÁS VIEJA (la primera que lo pagado,
 * repartido de la más vieja a la más nueva, no cubre: `proximoPago`):
 *
 *   - hasta su vencimiento (inclusive), nada: la tarjeta de pago informa a quien maneja la plata;
 *   - desde el día siguiente al vencimiento y durante 30 días, aviso para TODOS los usuarios con la
 *     fecha de corte;
 *   - cuando `vencimiento + 30 días < hoy`, Valida se pausa. Cuota que vence el 30-sep: aviso del
 *     1-oct al 30-oct, pausa desde el 31-oct.
 *
 * El pago nunca bloquea antes de esos 30 días.
 */

import type { ProximoPago } from './pago-pendiente'

/** Días de mora que la cláusula 11.1 tolera antes de suspender. */
export const DIAS_MORA_ANTES_DE_SUSPENDER = 30

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/

/** 'YYYY-MM-DD' + n días, en calendario (sin horas ni zonas de por medio). */
export function sumarDias(iso: string, dias: number): string {
  const m = FECHA.exec(iso)
  if (!m) throw new Error(`fecha inválida: ${iso}`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dias))
  return d.toISOString().slice(0, 10)
}

/** ¿Hoy todavía está dentro del plazo para aceptar? `null` = sin plazo = no. Una fecha ilegible, no. */
export function enPlazoParaAceptar(plazoHasta: string | null | undefined, hoy: string): boolean {
  if (!plazoHasta || !FECHA.test(plazoHasta)) return false
  return hoy <= plazoHasta
}

export type EstadoMora =
  /** Sin cuota vencida (o sin cuotas): nada que decirle a todos. */
  | { estado: 'al_dia' }
  /** Cuota vencida, dentro de los 30 días: aviso con la fecha de corte. */
  | { estado: 'en_mora'; vencio: string; corteDesde: string }
  /** Más de 30 días: Valida se pausa hasta que el pago se registre. */
  | { estado: 'suspendido'; vencio: string; corteDesde: string }

export function estadoMora(pago: ProximoPago, hoy: string): EstadoMora {
  if (pago.estado !== 'pendiente') return { estado: 'al_dia' }
  const vencio = pago.fechaVencimiento
  if (!FECHA.test(vencio) || !(vencio < hoy)) return { estado: 'al_dia' }
  const ultimoDiaTolerado = sumarDias(vencio, DIAS_MORA_ANTES_DE_SUSPENDER)
  const corteDesde = sumarDias(vencio, DIAS_MORA_ANTES_DE_SUSPENDER + 1)
  return ultimoDiaTolerado < hoy ? { estado: 'suspendido', vencio, corteDesde } : { estado: 'en_mora', vencio, corteDesde }
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const

/** '2026-09-30' → '30-sep'. Lo que no es una fecha sale tal cual. */
export function fechaDiaMes(iso: string): string {
  const m = FECHA.exec(iso)
  if (!m) return iso
  const mes = MESES[Number(m[2]) - 1]
  return mes ? `${Number(m[3])}-${mes}` : iso
}

/** El texto del aviso del plazo, para todos los usuarios del espacio. */
export function textoAvisoPlazo(plazoHasta: string): string {
  return (
    `La persona designada por tu empresa debe aceptar los Términos a más tardar el ${fechaDiaMes(plazoHasta)}; ` +
    `desde el ${fechaDiaMes(sumarDias(plazoHasta, 1))}, sin esa aceptación, Valida se pausa.`
  )
}

/** El texto del aviso de mora, para todos los usuarios del espacio. Sin montos. */
export function textoAvisoMora(m: Extract<EstadoMora, { estado: 'en_mora' }>): string {
  return (
    `Hay un pago de la suscripción vencido desde el ${fechaDiaMes(m.vencio)}. ` +
    `Si no se registra, Valida se pausa desde el ${fechaDiaMes(m.corteDesde)} (cláusula 11.1 de los términos).`
  )
}

/** Lo que responde cualquier acción de Valida con el servicio pausado por mora. */
export function mensajeSuspendidoPorMora(m: Extract<EstadoMora, { estado: 'suspendido' }>): string {
  return (
    `Valida está pausada desde el ${fechaDiaMes(m.corteDesde)} por un pago de la suscripción vencido desde el ` +
    `${fechaDiaMes(m.vencio)}. Se reactiva cuando se registre el pago.`
  )
}
