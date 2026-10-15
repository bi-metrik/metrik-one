import { COBRO_TRAS_PRUEBA } from './condiciones-cobro'

/**
 * El calendario del cobro al cumplirse los 7 días de la prueba (Condiciones v2.0, 7.1 a 7.3). Puro.
 *
 * Decisión de Mauricio (2026-10-12): opción A, fecha FIJA. El cobro va contra el instante en que se
 * cumplen los 7 días desde que se abrió la prueba (`vence_en`, con su hora). Desde la v2.1
 * (2026-10-14) hay un segundo momento: la Empresa CONFIRMA en su cuenta que activa el plan (la consulta
 * 11 se lo pide; también el botón «Activar plan»), y se cobra en ese momento (`cobrarAlConfirmar`).
 * Agotar las 10 consultas SIN confirmar no adelanta nada. Tres reglas del cobro del día 7, y las tres
 * las comprueban las pruebas:
 *
 *   1. **Sin confirmación, nunca antes del instante exacto** (fila 13 de Vera). El cron corre a las 07:00 de Bogotá: una
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

/**
 * El cobro del primer mes AL CONFIRMAR (Condiciones v2.1, 7.1 literal a; Términos v2.1, 3.5). Decisión
 * de Mauricio (2026-10-14): el primer mes se cobra en el primero de dos momentos, los 7 días o la
 * consulta 11 (agotó las 10 de prueba), pero nunca en silencio: la pantalla muestra el valor y la
 * tarjeta y la Empresa confirma con un botón. Sin ese clic, el cobro sigue siendo el del día 7.
 *
 * Solo lo puede pedir un registro que ACEPTÓ un texto que lo contempla: las Condiciones v2.0 dicen «el
 * cobro no se adelanta aunque las 10 consultas se agoten antes», así que a quien aceptó la v2.0 no se
 * le ofrece (se le cobra el día 7, como aceptó).
 */
export const CONDICIONES_CON_COBRO_AL_CONFIRMAR = { mayor: 2, menor: 1 } as const

export function permiteCobroAlConfirmar(condicionesVersion: string | null | undefined): boolean {
  const m = /^condiciones-(\d+)\.(\d+)\+/.exec(condicionesVersion ?? '')
  if (!m) return false
  const [mayor, menor] = [Number(m[1]), Number(m[2])]
  const min = CONDICIONES_CON_COBRO_AL_CONFIRMAR
  return mayor > min.mayor || (mayor === min.mayor && menor >= min.menor)
}

/** «$150.000». */
export function valorEnPesos(valor: number): string {
  return `$${PESOS_CONFIRMACION.format(valor)}`
}

const PESOS_CONFIRMACION = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

/**
 * Lo que dice la pantalla antes del botón, tal cual se guarda como constancia de lo confirmado
 * (`valida_registros.cobro_confirmado_texto`). `agotada`: la llegó a ver al intentar la consulta 11;
 * si no, la abrió desde «Activar plan» con consultas de prueba todavía.
 */
export function textoConfirmacionCobro(p: { valor: number; ultimos4: string; agotada: boolean; consultasPrueba: number }): {
  titulo: string
  detalle: string
  boton: string
} {
  // C7 del dictamen de Emilio (2026-10-14): la renovación mensual y la fecha de corte, en las dos variantes.
  const detalle = `Activa tu plan ahora: se cobran ${valorEnPesos(p.valor)} a tu tarjeta terminada en ${p.ultimos4} por el primer mes, y después cada mes en esta misma fecha hasta que te retires.`
  return {
    titulo: p.agotada ? `Usaste tus ${p.consultasPrueba} consultas de prueba` : 'Activa tu plan antes de que termine la prueba',
    detalle: p.agotada ? detalle : `${detalle} Tu plan queda activo desde este pago y la prueba termina.`,
    boton: `Activar y pagar ${valorEnPesos(p.valor)}`,
  }
}

/** El texto de la pantalla en un solo renglón: lo que se guarda (y se compara por huella) como lo que vio. */
export function constanciaConfirmacion(t: { titulo: string; detalle: string; boton: string }): string {
  return `${t.titulo}. ${t.detalle} [${t.boton}]`
}

/**
 * El correo que confirma el cobro del literal (a) (Condiciones v2.1, 7.2 con la C3 de Emilio): la fecha,
 * el valor y los últimos 4 dígitos. Es la prueba más útil ante un contracargo.
 *
 * ⚠️ Texto de Max (2026-10-14), no revisado por Vera. No promete nada que no digan la 7.1, la 7.4 y la
 * 3.5 de los Términos.
 */
export function correoCobroConfirmado(p: { razonSocial: string; cobradoAt: string; valor: number; ultimos4: string; urlCuenta: string }): {
  subject: string
  text: string
  html: string
} {
  const fecha = fechaYHoraBogota(p.cobradoAt)
  const valor = valorEnPesos(p.valor)
  const lineas = [
    'Hola:',
    `Confirmaste en tu cuenta la activación del plan de Valida de ${p.razonSocial}. El ${fecha} (hora de Colombia) cobramos ${valor} (valor total, sin IVA que sumar) por el primer mes a tu tarjeta terminada en ${p.ultimos4}.`,
    `Tu plan quedó activo desde ese pago, con hasta ${COBRO_TRAS_PRUEBA.limiteMensual.toLocaleString('es-CO')} consultas al mes. Después se cobra cada mes en esta misma fecha a la misma tarjeta, hasta que te retires. Puedes retirarte cuando quieras, sin penalidad; el mes ya pagado no se reembolsa.`,
    `Tu cuenta: ${p.urlCuenta}. Si no reconoces este cobro, escríbenos a mauricio.moreno@metrik.com.co.`,
    'METRIK IA S.A.S.',
  ]
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return {
    subject: `Cobramos ${valor} por tu plan de Valida (tarjeta terminada en ${p.ultimos4})`,
    text: lineas.join('\n\n'),
    html: lineas.map((l) => `<p>${esc(l)}</p>`).join('\n'),
  }
}

export type DesenlaceConfirmacion = 'cobrado' | 'pendiente' | 'rechazado' | 'revisar' | 'reintentar' | 'en_curso' | 'no_disponible'

/** Lo que ve la persona después de oprimir «Activar y pagar». */
export function textoTrasConfirmar(d: DesenlaceConfirmacion, p: { valor: number; ultimos4: string | null }): string {
  const tarjeta = p.ultimos4 ? `tu tarjeta terminada en ${p.ultimos4}` : 'la tarjeta que registraste'
  switch (d) {
    case 'cobrado':
      return `Listo: cobramos ${valorEnPesos(p.valor)} a ${tarjeta} y tu plan quedó activo. Ya puedes seguir consultando.`
    case 'pendiente':
      return 'ePayco dejó el pago en revisión. Tu plan se activa apenas lo apruebe y te avisamos al correo. No lo intentes de nuevo.'
    case 'rechazado':
      // 7.5 v2.1 (decisión 2026-10-14): conserva la prueba y el cobro del día 7 sigue en pie.
      return `No se pudo cobrar a ${tarjeta}: el pago fue rechazado. No se cobró nada y tu plan no quedó activo. Conservas lo que te queda de la prueba. Te enviamos al correo un enlace para pagar con otro medio; si no pagas ni cancelas, el cobro se intenta otra vez al cumplirse los 7 días.`
    case 'revisar':
      return 'No pudimos confirmar con ePayco si el cobro se hizo. No lo intentes de nuevo: lo revisamos y te escribimos al correo.'
    case 'reintentar':
      return 'No pudimos activar tu plan en este momento y no se cobró nada. Intenta de nuevo en un momento.'
    case 'en_curso':
      return 'Tu cobro ya está en curso. Recarga la página en un momento.'
    default:
      return 'No podemos activar tu plan desde aquí. Escríbenos a mauricio.moreno@metrik.com.co y lo hacemos contigo.'
  }
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
