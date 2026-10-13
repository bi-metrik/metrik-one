import { COBRO_TRAS_PRUEBA } from './condiciones-cobro'

/**
 * El calendario del cobro al cumplirse los 7 días de la prueba (Condiciones v2.0, 7.1 a 7.3). Puro.
 *
 * Decisión de Mauricio (2026-10-12): opción A, fecha FIJA. El cobro va contra el instante en que se
 * cumplen los 7 días desde que se abrió la prueba (`vence_en`, con su hora), aunque las 10 consultas
 * se agoten antes. Tres reglas, y las tres las comprueban las pruebas:
 *
 *   1. **Nunca antes del instante exacto** (fila 13 de Vera). El cron corre a las 07:00 de Bogotá: una
 *      prueba que abrió un martes a las 15:00 se cobra el miércoles siguiente a las 07:00, no el martes.
 *   2. **El aviso del 7.2 sale al menos 48 horas antes del cobro.** Se manda en la primera corrida que
 *      cae en las 72 horas previas al instante (con un cron diario siempre hay una entre 72 y 48 h).
 *      Si esa corrida falló y el aviso sale tarde, el cobro se corre: nunca menos de 48 h después del
 *      aviso. El correo dice esa fecha («después de ese momento»).
 *   3. **Cancelar se respeta hasta que una corrida empieza a cobrar.** El texto dice «antes de que se
 *      cumplan los 7 días»; dejar cancelar unas horas más, mientras no se ha cobrado, solo favorece a
 *      la Empresa y evita el contracargo de quien canceló a las 15:05.
 *
 * ## Probarlo en un preview sin esperar 7 días
 *
 * `VALIDA_COBRO_PRUEBA_MINUTOS=N` (solo fuera de producción: allí se ignora) pone el cobro N minutos
 * después de abrir la prueba y escala el aviso en la misma proporción (48/168 del plazo). Con N = 14:
 * aviso desde el minuto 8, cobro desde el minuto 14 y no antes de 4 minutos después del aviso.
 */

type Env = Record<string, string | undefined>

const HORA_MS = 3_600_000
const DIA_MS = 24 * HORA_MS
export const DURACION_PRUEBA_MS = COBRO_TRAS_PRUEBA.dias * DIA_MS
export const ANTELACION_AVISO_MS = COBRO_TRAS_PRUEBA.horasAviso * HORA_MS
/** El aviso se manda desde 72 h antes: 1,5 veces la antelación (cabe siempre una corrida diaria). */
const VENTANA_AVISO = 1.5

/** El despliegue que corre esto. Los previews usan la base de producción: cada uno procesa lo suyo. */
export function entornoDeCobro(env: Env = process.env): 'production' | 'preview' | 'development' {
  if (env.VERCEL_ENV === 'production') return 'production'
  if (env.VERCEL_ENV === 'preview') return 'preview'
  return 'development'
}

/** Los minutos de la prueba acortada, solo fuera de producción. `null` = los 7 días de verdad. */
export function minutosDePruebaAcortada(env: Env = process.env): number | null {
  if (entornoDeCobro(env) === 'production') return null
  const n = Number(env.VALIDA_COBRO_PRUEBA_MINUTOS)
  return Number.isInteger(n) && n >= 1 && n <= 7 * 24 * 60 ? n : null
}

/**
 * El instante del cobro, que se guarda al abrir la prueba (`cobro_programado_at`) y no se recalcula:
 * es la fecha que se le informó a la Empresa. Es el `vence_en` de la prueba que emitió Valida; sin él,
 * la apertura más 7 días.
 */
export function momentoDelCobro(p: { venceEn: string | null; aperturaMs: number }, env: Env = process.env): string {
  const minutos = minutosDePruebaAcortada(env)
  if (minutos !== null) return new Date(p.aperturaMs + minutos * 60_000).toISOString()
  const vence = p.venceEn ? Date.parse(p.venceEn) : NaN
  return new Date(Number.isFinite(vence) ? vence : p.aperturaMs + DURACION_PRUEBA_MS).toISOString()
}

/** Cuánto antes del cobro sale el aviso: 48 h, o la misma proporción en la prueba acortada. */
export function antelacionAvisoMs(env: Env = process.env): number {
  const minutos = minutosDePruebaAcortada(env)
  if (minutos === null) return ANTELACION_AVISO_MS
  return Math.round((minutos * 60_000 * COBRO_TRAS_PRUEBA.horasAviso) / (COBRO_TRAS_PRUEBA.dias * 24))
}

/** Desde cuándo se puede cobrar: el instante de los 7 días, y nunca menos de 48 h después del aviso. */
export function cobroDesdeMs(p: { programadoMs: number; avisoMs: number }, antelacionMs: number): number {
  return Math.max(p.programadoMs, p.avisoMs + antelacionMs)
}

export interface RegistroConCobro {
  cobro_estado: string | null
  cobro_programado_at: string | null
  cobro_aviso_enviado_at: string | null
}

export type PasoCobro = 'nada' | 'avisar' | 'esperar' | 'cobrar'

/** Qué toca hacer con un registro en esta corrida. */
export function pasoDelCobro(r: RegistroConCobro, ahoraMs: number, antelacionMs: number): PasoCobro {
  if (r.cobro_estado !== 'programado' || !r.cobro_programado_at) return 'nada'
  const programadoMs = Date.parse(r.cobro_programado_at)
  if (!Number.isFinite(programadoMs)) return 'nada'
  if (!r.cobro_aviso_enviado_at) {
    return ahoraMs >= programadoMs - VENTANA_AVISO * antelacionMs ? 'avisar' : 'esperar'
  }
  const avisoMs = Date.parse(r.cobro_aviso_enviado_at)
  if (!Number.isFinite(avisoMs)) return 'esperar'
  return ahoraMs >= cobroDesdeMs({ programadoMs, avisoMs }, antelacionMs) ? 'cobrar' : 'esperar'
}

/** ¿La Empresa todavía puede cancelar? Mientras ninguna corrida haya empezado a cobrar. */
export function puedeCancelar(cobroEstado: string | null): boolean {
  return cobroEstado === 'programado'
}

const FECHA_HORA = new Intl.DateTimeFormat('es-CO', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Bogota',
})

/** «martes, 20 de octubre de 2026, 3:15 p. m.», en hora de Colombia. */
export function fechaYHoraBogota(iso: string | number): string {
  return FECHA_HORA.format(new Date(iso))
}

const PESOS = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

/**
 * El correo del 7.2: «con la fecha, el valor y cómo cancelar».
 *
 * ⚠️ PENDIENTE DE VERA: texto propuesto por Max el 2026-10-12, no revisado. No cambia ni agrega nada a
 * lo que dicen las Condiciones (7.1 a 7.4); cualquier ajuste de Vera se copia aquí tal cual. El cobro
 * en producción sigue apagado (`CLAUSULA_COBRO_APROBADA_PARA_PRODUCCION = false`), así que este correo
 * solo sale en un preview mientras tanto.
 */
export const CORREO_AVISO_REVISADO_POR_VERA = false

export function correoAvisoCobro(p: { razonSocial: string; cobroDesde: string; urlCuenta: string }): {
  subject: string
  text: string
  html: string
} {
  const fecha = fechaYHoraBogota(p.cobroDesde)
  const valor = `$${PESOS.format(COBRO_TRAS_PRUEBA.precio)}`
  const subject = `Tu prueba de Valida termina el ${fecha}`
  const lineas = [
    'Hola:',
    `La prueba gratis de Valida de ${p.razonSocial} termina el ${fecha} (hora de Colombia).`,
    `Si no la cancelas antes, después de ese momento cobraremos ${valor} (valor total, sin IVA que sumar) por el primer mes del plan a la tarjeta que registraste en ePayco, y después cada mes hasta que te retires.`,
    `Para no pagar, cancela antes de esa hora con el botón "${COBRO_TRAS_PRUEBA.botonCancelar}" de tu cuenta: ${p.urlCuenta}. También puedes escribir a mauricio.moreno@metrik.com.co.`,
    'METRIK IA S.A.S.',
  ]
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = lineas.map((l) => `<p>${esc(l)}</p>`).join('\n')
  return { subject, text: lineas.join('\n\n'), html }
}
