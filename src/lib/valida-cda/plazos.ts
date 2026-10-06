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
 * ## 2. La mora (cláusula 11 de los términos, v1.4 desde el 2026-11-05)
 *
 * Se mide sobre la cuota impaga MÁS VIEJA (la primera que lo pagado, repartido de la más vieja a la
 * más nueva, no cubre: `proximoPago`). Con vencimiento D:
 *
 *   - hasta D (inclusive), nada: la tarjeta de pago informa a quien maneja la plata;
 *   - desde D+1, aviso para TODOS los usuarios con la fecha en que se restringe (11.2);
 *   - desde D+6 (`restringido`, 11.1): se niegan las CONSULTAS NUEVAS, individuales y masivas. Se
 *     siguen viendo y descargando los reportes ya generados, y los usuarios siguen entrando;
 *   - desde D+31 (`suspendido`, 11.3: «obligaciones vencidas superiores a treinta días»): Valida se
 *     pausa entera, como desde el PR #849.
 *
 * La restricción rige desde `RESTRICCION_VIGENTE_DESDE` (11.4: 30 días después del aviso de la 13.1)
 * y alcanza también a las cuotas vencidas antes: una cuota con D+6 anterior a esa fecha se restringe
 * ESE día, no antes. Antes de la vigencia solo existe la regla de los 30 días (v1.3).
 *
 * Cuota que vence el 10-nov: aviso del 11-nov al 15-nov, restringido del 16-nov al 10-dic, pausa
 * desde el 11-dic. Cuota que vence el 15-oct: aviso desde el 16-oct (con la fecha 5-nov), restringido
 * desde el 5-nov, pausa desde el 15-nov.
 *
 * El pago levanta todo en la petición siguiente: nada de esto se cachea más allá del request.
 */

import type { ProximoPago } from './pago-pendiente'

/** Días de mora que la cláusula 11.3 tolera antes de suspender (más de 30: se pausa el día 31). */
export const DIAS_MORA_ANTES_DE_SUSPENDER = 30

/** Días de mora que la cláusula 11.1 (v1.4) tolera antes de restringir las consultas nuevas. */
export const DIAS_MORA_ANTES_DE_RESTRINGIR = 5

/**
 * Desde cuándo rige la restricción de la cláusula 11.1 (v1.4): 30 días después del aviso enviado el
 * 2026-10-06 (cláusula 13.1). Si el aviso sale otro día, esta fecha se corre con él.
 */
export const RESTRICCION_VIGENTE_DESDE = '2026-11-05'

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
  /**
   * Cuota vencida, todavía sin restricción: aviso con la fecha de la restricción (`restringeDesde`) y la
   * de la pausa. `restringeDesde` es `null` solo cuando la pausa llega antes de que rija la restricción
   * (cuotas vencidas a comienzos de octubre de 2026).
   */
  | { estado: 'en_mora'; vencio: string; restringeDesde: string | null; corteDesde: string }
  /** Más de 5 días: se niegan las consultas nuevas; el histórico sigue abierto. */
  | { estado: 'restringido'; vencio: string; restringeDesde: string; corteDesde: string }
  /** Más de 30 días: Valida se pausa hasta que el pago se registre. */
  | { estado: 'suspendido'; vencio: string; corteDesde: string }

export function estadoMora(
  pago: ProximoPago,
  hoy: string,
  vigenteDesde: string = RESTRICCION_VIGENTE_DESDE,
): EstadoMora {
  if (pago.estado !== 'pendiente') return { estado: 'al_dia' }
  const vencio = pago.fechaVencimiento
  if (!FECHA.test(vencio) || !(vencio < hoy)) return { estado: 'al_dia' }
  const corteDesde = sumarDias(vencio, DIAS_MORA_ANTES_DE_SUSPENDER + 1)
  if (corteDesde <= hoy) return { estado: 'suspendido', vencio, corteDesde }
  // La regla de los 5 días no existe antes de su vigencia, y desde ella alcanza a lo ya vencido.
  const porDias = sumarDias(vencio, DIAS_MORA_ANTES_DE_RESTRINGIR + 1)
  const desde = porDias < vigenteDesde ? vigenteDesde : porDias
  const restringeDesde = desde < corteDesde ? desde : null
  if (restringeDesde && restringeDesde <= hoy) return { estado: 'restringido', vencio, restringeDesde, corteDesde }
  return { estado: 'en_mora', vencio, restringeDesde, corteDesde }
}

/** ¿El estado deja hacer consultas nuevas? Solo al día o en mora sin restricción. */
export function moraPermiteConsultar(m: EstadoMora): boolean {
  return m.estado === 'al_dia' || m.estado === 'en_mora'
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'] as const

/** '2026-09-30' → '30-sep'. Lo que no es una fecha sale tal cual. */
export function fechaDiaMes(iso: string): string {
  const m = FECHA.exec(iso)
  if (!m) return iso
  const mes = MESES[Number(m[2]) - 1]
  return mes ? `${Number(m[3])}-${mes}` : iso
}

/**
 * El texto del aviso del plazo, para todos los usuarios del espacio. `plazoHasta` es el último día en
 * que Valida opera sin la aceptación (inclusive): al terminar ese día se suspende.
 */
export function textoAvisoPlazo(plazoHasta: string): string {
  return (
    `El servicio de Valida se suspenderá al terminar el ${fechaDiaMes(plazoHasta)} ` +
    `si la persona designada por tu empresa no ha aceptado los Términos.`
  )
}

/** El texto del aviso de mora, para todos los usuarios del espacio (cláusula 11.2). Sin montos. */
export function textoAvisoMora(m: Extract<EstadoMora, { estado: 'en_mora' }>): string {
  const vencido = `Hay un pago de la suscripción vencido desde el ${fechaDiaMes(m.vencio)}.`
  if (!m.restringeDesde) {
    return `${vencido} Si no se registra, Valida se pausa desde el ${fechaDiaMes(m.corteDesde)} (cláusula 11 de los términos).`
  }
  return (
    `${vencido} Si no se registra, desde el ${fechaDiaMes(m.restringeDesde)} no se podrán hacer consultas nuevas; ` +
    `los reportes ya generados seguirán disponibles (cláusula 11 de los términos).`
  )
}

/** Lo que responde una consulta nueva (individual o masiva) con las consultas restringidas por mora. */
export function mensajeConsultasRestringidas(m: Extract<EstadoMora, { estado: 'restringido' }>): string {
  return (
    `Las consultas nuevas están restringidas desde el ${fechaDiaMes(m.restringeDesde)} por un pago de la ` +
    `suscripción vencido desde el ${fechaDiaMes(m.vencio)}. Los reportes ya generados siguen disponibles. ` +
    `Las consultas se habilitan de nuevo cuando se registre el pago.`
  )
}

/** El aviso de la restricción en `/valida`: el mensaje, más la fecha de la pausa si sigue sin pago. */
export function textoAvisoRestriccion(m: Extract<EstadoMora, { estado: 'restringido' }>): string {
  return `${mensajeConsultasRestringidas(m)} Si no se registra, Valida se pausa desde el ${fechaDiaMes(m.corteDesde)}.`
}

/** Lo que responde cualquier acción de Valida con el servicio pausado por mora. */
export function mensajeSuspendidoPorMora(m: Extract<EstadoMora, { estado: 'suspendido' }>): string {
  return (
    `Valida está pausada desde el ${fechaDiaMes(m.corteDesde)} por un pago de la suscripción vencido desde el ` +
    `${fechaDiaMes(m.vencio)}. Se reactiva cuando se registre el pago.`
  )
}
