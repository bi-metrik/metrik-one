/**
 * El reverso del pago de un ciclo de Valida autogestionada CIERRA el plan en el acto (decisión de
 * Mauricio, 2026-10-27; Emilio lo aprobó con condiciones). Puro: textos, clasificación de la respuesta
 * de Valida y las reglas pequeñas. El cómo vive en `corte-reverso-servidor.ts`.
 *
 * Contrato de Valida (metrik-valida#82): `POST /api/one/v1/autogestion/{cliente}/ciclos/anular`, firmada
 * como ONE, `{ actor, referencia: 'one-ciclo:<cobro>', motivo (1-200) }`. Idempotente: repetirla da el
 * conteo del primer acto. 404 cliente_no_existe / ciclo_no_existe, 422 no_es_autogestion y 409
 * ciclo_reemplazado no se arreglan reintentando; 500, 503, la red y lo demás sí.
 */

import { formatCOP } from '@/lib/cobros/format'
import type { ResultadoValida } from '@/lib/valida-api/cliente-nucleo'
import type { CorteReverso } from './plan'

/**
 * ⚠️ PENDIENTE DE VERA: el correo al cliente (texto mínimo de Emilio, 2026-10-27). Mientras esté en
 * `false`, en PRODUCCIÓN el corte se hace igual y el correo NO sale (queda `retenido`); en un preview sí
 * sale. Encenderlo es un PR que cambia esta línea después del visto bueno de Vera.
 */
export const AVISO_REVERSO_CLIENTE_APROBADO = false

/** Intentos de anular antes de dejarlo a una persona (webhook + cron diario: un mes, de sobra). */
export const TOPE_INTENTOS_CORTE = 30

/** Los rechazos de Valida que son estado final: reintentar no cambia la respuesta. */
export const RECHAZOS_FINALES: readonly string[] = ['cliente_no_existe', 'ciclo_no_existe', 'no_es_autogestion', 'ciclo_reemplazado']

/** El motivo que viaja a Valida (1-200): qué pasó y que lo hizo ONE solo. */
export function motivoCorte(referenciaPago: string): string {
  return `Reverso del pago ${referenciaPago}: la plata volvió al pagador. ONE cierra el plan en el acto.`.slice(0, 200)
}

/** El estado del corte después de una respuesta de Valida a `ciclos/anular`. */
export function corteTrasRespuesta(
  previo: CorteReverso,
  r: ResultadoValida<{ anulado_en?: string; ya_anulado?: boolean }>,
  ahoraIso: string,
): CorteReverso {
  const intentos = previo.intentos + 1
  const base = { ...previo, intentos, ultimo_intento_at: ahoraIso }
  if (r.tipo === 'ok') {
    const en = typeof r.datos.anulado_en === 'string' && r.datos.anulado_en ? r.datos.anulado_en : ahoraIso
    return { ...base, estado: 'anulado', anulado_en: en, detalle: r.datos.ya_anulado ? 'Valida ya lo tenía anulado.' : 'Valida cerró el ciclo.' }
  }
  if (r.tipo === 'rechazada' && RECHAZOS_FINALES.includes(r.codigo)) {
    return { ...base, estado: 'final', detalle: `Valida respondió ${r.status} ${r.codigo}: no se cerró y no se reintenta.` }
  }
  const por = r.tipo === 'rechazada' ? `${r.status} ${r.codigo}` : `${r.motivo}${r.status ? ` ${r.status}` : ''}`
  if (intentos >= TOPE_INTENTOS_CORTE) {
    return { ...base, estado: 'final', detalle: `Valida no cerró el ciclo en ${intentos} intentos (último: ${por}). Queda a mano.` }
  }
  return { ...base, estado: 'pendiente', detalle: `Valida no cerró el ciclo (${por}). Lo reintenta el cron.` }
}

const ZONA = 'America/Bogota'
const DIA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const FECHA = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: ZONA })
const HORA = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: ZONA })
const YMD = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: ZONA })

/** '2026-10-22' → '22 de octubre de 2026'. */
export function fechaLarga(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd)
  if (!m) return ymd
  return DIA.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)))
}

/** Un instante → '27 de octubre de 2026 a las 10:42 a. m.' (hora de Colombia). */
export function fechaYHoraLarga(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // ICU separa «a. m.» con espacios duros (U+00A0 / U+202F): en un correo de texto van espacios normales.
  return `${FECHA.format(d)} a las ${HORA.format(d)}`.replace(/[  ]/g, ' ')
}

/** El día de Bogotá ('YYYY-MM-DD') de un instante. */
export function diaBogota(iso: string | number): string {
  return YMD.format(new Date(iso))
}

/** El correo sale el mismo día (de Bogotá) del corte, o no sale. */
export function mismoDiaDelCorte(anuladoEn: string, ahoraMs: number): boolean {
  return diaBogota(anuladoEn) === diaBogota(ahoraMs)
}

/** ¿Puede salir el correo al cliente? En producción solo con el visto bueno de Vera. */
export function avisoClienteHabilitado(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== 'production' || AVISO_REVERSO_CLIENTE_APROBADO
}

export interface DatosSuspension {
  monto: number
  desde: string
  hasta: string
  anuladoEn: string
  razonSocial: string
}

/** La frase central, la misma en el correo y en la pantalla (texto de Emilio). */
export function frasesSuspension(d: DatosSuspension): { reversado: string; desde: string; disponibles: string } {
  return {
    reversado: `El pago de ${formatCOP(d.monto)} del período ${fechaLarga(d.desde)}–${fechaLarga(d.hasta)} fue reversado.`,
    // «S.A.S.» ya cierra con punto: sin el del texto, que daría «S.A.S..».
    desde: `Desde el ${fechaYHoraLarga(d.anuladoEn)}, Valida no permite consultas nuevas para ${d.razonSocial.trim().replace(/\.$/, '')}.`,
    disponibles: 'Tus reportes y tu historial siguen disponibles.',
  }
}

function escapar(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

/**
 * ⚠️ PENDIENTE DE VERA (ver `AVISO_REVERSO_CLIENTE_APROBADO`). El cuerpo es el texto mínimo de Emilio,
 * palabra por palabra; el saludo, el asunto y la firma son los de los demás correos de Valida.
 */
export function correoSuspensionPorReverso(d: DatosSuspension & { url: string }): { subject: string; text: string; html: string } {
  const f = frasesSuspension(d)
  const cuerpo = `${f.reversado} ${f.desde} ${f.disponibles} Para reactivar el plan, paga el período aquí: ${d.url}.`
  const lineas = ['Hola:', cuerpo, 'METRIK IA S.A.S.']
  const html = [
    '<p>Hola:</p>',
    `<p>${escapar(`${f.reversado} ${f.desde} ${f.disponibles} Para reactivar el plan, paga el período `)}<a href="${escapar(d.url)}">aquí</a>: ${escapar(d.url)}.</p>`,
    '<p>METRIK IA S.A.S.</p>',
  ].join('\n')
  return { subject: 'Valida: tu plan está suspendido por la reversión del pago', text: lineas.join('\n\n'), html }
}

/** La dirección de `/valida` en el subdominio del espacio: ahí está el botón para pagar el período. */
export function urlValidaDelEspacio(slug: string, env: Record<string, string | undefined> = process.env): string {
  const base = (env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co').trim()
  return `https://${slug}.${base}/valida`
}
