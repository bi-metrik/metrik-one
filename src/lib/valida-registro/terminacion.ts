/**
 * La terminación de una suscripción autogestionada de Valida a los treinta días de suspensión sin pago
 * (Términos de autoservicio v2.1 y v2.2, cláusula 11.2): «Si pasan treinta (30) días calendario de
 * suspensión por falta de pago o por reversión del pago sin que el Cliente pague, la suscripción termina
 * sin más aviso y METRIK pide a la pasarela eliminar el medio de pago.» Pedido de Mauricio, 2026-10-29.
 *
 * Puro: cuándo empezó la suspensión, qué día se cumplen los 30 días, el interruptor y el aviso interno.
 * El cómo (leer, cerrar los cobros, pedir el borrado a ePayco) vive en `terminacion-servidor.ts`.
 *
 * ## Desde cuándo se cuenta
 *
 *   - **Mora**: desde que vence la bolsa del último mes pagado (`valida_plan.vence_en`, el día
 *     `DIAS_GRACIA_CICLO` de mora de la cuota siguiente). Esa es la suspensión de la 11.1: Valida
 *     responde que no hay consultas.
 *   - **Reverso**: desde que Valida cerró el ciclo (`valida_plan.reversado.corte.anulado_en`, 11.3). Un
 *     corte `pendiente` (Valida no respondió) todavía no suspende nada.
 *   - Si están los dos, manda el más viejo: la suspensión empezó ahí.
 *
 * ## Cómo se cuentan los 30 días
 *
 * Días calendario de Bogotá COMPLETOS de suspensión. Si la suspensión empieza a la medianoche de Bogotá
 * (la bolsa vence siempre así), ese día es el primero; si empieza a mitad del día (el corte por reverso),
 * el primero es el día siguiente. La terminación es el día 31: el primer día completo + 30. Ejemplo:
 * bolsa vencida el 23-nov a las 00:00 → termina el 23-dic. Corte el 10-nov a las 15:00 → primer día
 * completo el 11-nov → termina el 11-dic. Es la lectura que menos le quita al cliente; la confirma Emilio.
 */

import { todayBogotaISO } from '@/lib/dates/bogota'
import { formatCOP } from '@/lib/cobros/format'
import { DIAS_SUSPENSION_ANTES_DE_TERMINAR, sumarDias } from '@/lib/valida-cda/plazos'
import type { PlanAbierto, TerminacionPlan } from './plan'

/**
 * APAGADA en producción hasta que Vera y Emilio lo aprueben (otro PR la enciende). Mientras sea `false`,
 * en producción (`VERCEL_ENV=production`) el cron solo registra lo que haría (`por_terminar`) y avisa a
 * MéTRIK; en un preview (y en local) termina de verdad. El mismo patrón de `AVISO_REVERSO_CLIENTE_APROBADO`.
 */
export const TERMINACION_30_DIAS_APROBADA = false

export function terminacionHabilitada(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== 'production' || TERMINACION_30_DIAS_APROBADA
}

/** Intentos de pedir el borrado de la tarjeta antes de dejarlo a una persona (cron diario: un mes). */
export const TOPE_INTENTOS_TARJETA = 30

/** A dónde va el aviso interno. Es de MéTRIK, nunca del cliente («sin más aviso»). */
export const AVISO_TERMINACION_PARA = 'mauricio.moreno@metrik.com.co'

export interface Suspension {
  motivo: TerminacionPlan['motivo']
  /** El instante (ISO) en que empezó. */
  desde: string
  /** El día de Bogotá en que se cumplen los 30 días y la suscripción termina. */
  diaTerminacion: string
}

/** El primer día de Bogotá COMPLETO de suspensión que empieza en `desdeIso`. */
export function primerDiaCompleto(desdeIso: string): string {
  const ms = Date.parse(desdeIso)
  const dia = todayBogotaISO(new Date(ms))
  return Date.parse(`${dia}T00:00:00-05:00`) === ms ? dia : sumarDias(dia, 1)
}

/** El día de Bogotá en que termina la suscripción suspendida desde `desdeIso`. */
export function diaDeTerminacion(desdeIso: string): string {
  return sumarDias(primerDiaCompleto(desdeIso), DIAS_SUSPENSION_ANTES_DE_TERMINAR)
}

/**
 * La suspensión vigente del plan a `ahoraMs`, o `null` si no está suspendido. No mira si hay deuda: eso
 * lo comprueba el servidor contra los cobros (un pago registrado cuyo ciclo no se abrió no es mora).
 */
export function suspensionDelPlan(plan: PlanAbierto, ahoraMs: number): Suspension | null {
  const candidatas: { motivo: Suspension['motivo']; desde: string }[] = []
  const corte = plan.reversado?.corte
  if (corte?.estado === 'anulado') {
    const desde = corte.anulado_en ?? plan.reversado?.at
    if (desde && Number.isFinite(Date.parse(desde))) candidatas.push({ motivo: 'reverso', desde })
  }
  const vence = Date.parse(plan.vence_en)
  if (Number.isFinite(vence) && vence <= ahoraMs) candidatas.push({ motivo: 'mora', desde: plan.vence_en })
  if (candidatas.length === 0) return null
  const primera = candidatas.sort((a, b) => Date.parse(a.desde) - Date.parse(b.desde))[0]
  return { ...primera, diaTerminacion: diaDeTerminacion(primera.desde) }
}

/** ¿Ya se cumplieron los 30 días (hoy, en Bogotá, es el día de la terminación o después)? */
export function cumplioTreintaDias(s: Suspension, ahoraMs: number): boolean {
  return todayBogotaISO(new Date(ahoraMs)) >= s.diaTerminacion
}

/** ¿Queda algo por hacer de una terminación ya hecha? */
export function terminacionIncompleta(t: TerminacionPlan): boolean {
  return t.estado === 'terminada' && (!t.cobros_cerrados || !t.tarjeta || t.tarjeta.estado === 'pendiente' || t.aviso_interno?.estado !== 'enviado')
}

/** El motivo de la cancelación en `suscripciones_producto.cancelacion_motivo`. */
export function motivoCancelacion(t: Pick<TerminacionPlan, 'motivo' | 'dia_terminacion'>): string {
  const causa = t.motivo === 'reverso' ? 'por reversión del pago' : 'por falta de pago'
  return `Terminada el ${t.dia_terminacion} por la cláusula 11.2 de los Términos: 30 días calendario de suspensión ${causa} sin que el Cliente pagara.`
}

export interface DatosAvisoTerminacion {
  ensayo: boolean
  slug: string
  razonSocial: string | null
  nit: string | null
  t: TerminacionPlan
  /** Lo que se le debe (las cuotas vencidas sin pagar), si se pudo leer. */
  deuda: number | null
}

const NOMBRE_TARJETA: Record<NonNullable<TerminacionPlan['tarjeta']>['estado'], string> = {
  borrada: 'ePayco confirmó el borrado de la tarjeta.',
  pendiente: 'ePayco NO borró la tarjeta todavía: el cron lo reintenta cada día.',
  sin_tarjeta: 'El espacio no tenía tarjeta guardada en ePayco.',
  final: 'La tarjeta NO se pudo borrar: hay que pedirlo a ePayco a mano.',
}

/** El correo interno a MéTRIK. Nunca al cliente. */
export function correoAvisoTerminacion(d: DatosAvisoTerminacion): { subject: string; text: string; html: string } {
  const quien = `${d.razonSocial ?? 'sin razón social'}${d.nit ? ` (NIT ${d.nit})` : ''}, espacio ${d.slug}`
  const causa = d.t.motivo === 'reverso' ? 'reversión del pago (11.3)' : 'falta de pago (11.1)'
  const lineas = [
    d.ensayo
      ? `ENSAYO (terminación apagada en producción, TERMINACION_30_DIAS_APROBADA = false): no se hizo nada.`
      : `La suscripción de Valida de ${quien} TERMINÓ por la cláusula 11.2 de los Términos de autoservicio.`,
    d.ensayo ? `Esta suscripción cumplió los 30 días de suspensión y se terminaría hoy: ${quien}.` : null,
    `Suspendida por ${causa} desde ${d.t.suspendida_desde}; los 30 días calendario se cumplieron el ${d.t.dia_terminacion}.`,
    d.deuda !== null ? `Cuotas vencidas sin pagar: ${formatCOP(d.deuda)}. Siguen en la cartera: ONE no las anuló.` : null,
    d.ensayo
      ? 'Al encenderla: se termina el contrato, el plan de cobro deja de renovarse, la suscripción queda cancelada y se pide a ePayco borrar la tarjeta. Al cliente no se le escribe («sin más aviso»).'
      : `Hecho: contrato terminado, plan de cobro sin renovación ni cobros automáticos, suscripción cancelada. ${d.t.tarjeta ? NOMBRE_TARJETA[d.t.tarjeta.estado] : ''}${d.t.tarjeta?.error ? ` (${d.t.tarjeta.error})` : ''}`,
    'Al cliente no se le escribió. Los reportes siguen como hoy (pregunta abierta con Emilio: 12.6 frente a SARLAFT y Ley 1581).',
    'Si el cliente paga después (un enlace que tenía vigente), el pago NO reabre el servicio: queda para una persona.',
  ].filter((l): l is string => l !== null)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return {
    subject: `${d.ensayo ? '[Ensayo] ' : ''}Valida: suscripción ${d.ensayo ? 'por terminar' : 'terminada'} por 30 días de suspensión — ${d.razonSocial ?? d.slug}`,
    text: lineas.join('\n\n'),
    html: lineas.map((l) => `<p>${esc(l)}</p>`).join('\n'),
  }
}
