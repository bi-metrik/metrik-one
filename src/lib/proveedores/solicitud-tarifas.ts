/**
 * La solicitud de actualización de tarifas a un proveedor (Mauricio, 2026-10-19). PURO.
 *
 * Decisión: «al disparar la solicitud de actualización de tarifas se le pregunta a cada proveedor si
 * el precio es neto o comisionable y si incluye IVA». ONE arma el mensaje (WhatsApp o correo) y la
 * asesora lo envía desde su teléfono o su correo: ONE no le escribe al proveedor por su cuenta.
 * Lo que el proveedor conteste se anota en la ficha (`tarifa_canal`, `iva_declarado`,
 * `iva_incluido`).
 *
 * Las preguntas que ya tienen respuesta en la ficha no se repiten.
 */
import type { TarifaCanal } from './tipos'

export interface DatosSolicitud {
  proveedor: string
  contacto: string | null
  /** La agencia que pide (nombre del espacio). */
  agencia: string
  /** El año del tarifario que se pide. */
  anio: number
  tarifaCanal: TarifaCanal | null
  ivaDeclarado: boolean | null
  ivaIncluido: boolean | null
}

/** Las preguntas que faltan, en el orden en que se hacen. */
export function preguntasPendientes(d: Pick<DatosSolicitud, 'tarifaCanal' | 'ivaDeclarado' | 'ivaIncluido'>): string[] {
  const p: string[] = []
  if (!d.tarifaCanal) p.push('¿Las tarifas son netas o comisionables? Si son comisionables, ¿qué porcentaje de comisión manejan?')
  if (d.ivaDeclarado === null || d.ivaIncluido === null) p.push('¿Cobran IVA? Si lo cobran, ¿los precios ya lo incluyen o se suma aparte?')
  return p
}

/** El texto del mensaje, listo para WhatsApp o para el cuerpo del correo. */
export function mensajeSolicitud(d: DatosSolicitud): string {
  const saludo = d.contacto ? `Hola, ${d.contacto.split(/\s+/)[0]}.` : 'Hola.'
  const preguntas = preguntasPendientes(d)
  const lineas = [
    saludo,
    `Te escribimos de ${d.agencia}. Estamos actualizando las tarifas de ${d.proveedor} para ${d.anio}.`,
    `¿Nos puedes compartir el tarifario ${d.anio} con las fechas de cada temporada (alta, media y baja)?`,
  ]
  if (preguntas.length > 0) {
    lineas.push('', 'Y para cotizar bien:')
    preguntas.forEach((q, i) => lineas.push(`${i + 1}. ${q}`))
  }
  lineas.push('', 'Muchas gracias.')
  return lineas.join('\n')
}

/** El asunto del correo. */
export function asuntoSolicitud(d: Pick<DatosSolicitud, 'proveedor' | 'anio' | 'agencia'>): string {
  return `Tarifas ${d.anio} de ${d.proveedor} · ${d.agencia}`
}

/** Enlace de WhatsApp con el mensaje (celular en E.164). `null` sin celular. */
export function enlaceWhatsApp(celularE164: string | null | undefined, texto: string): string | null {
  const digitos = (celularE164 ?? '').replace(/\D/g, '')
  if (digitos.length < 7) return null
  return `https://wa.me/${digitos}?text=${encodeURIComponent(texto)}`
}

/** Enlace de correo con asunto y cuerpo. `null` sin correo. */
export function enlaceCorreo(correo: string | null | undefined, asunto: string, texto: string): string | null {
  const c = (correo ?? '').trim()
  if (!c || !c.includes('@')) return null
  return `mailto:${c}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(texto)}`
}
