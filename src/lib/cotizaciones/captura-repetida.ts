/**
 * El pantallazo repetido en la bandeja (P10 del caso Providencia, Mauricio 2026-09-23).
 *
 * Tres casos, y ninguno bloquea en silencio:
 *
 *  · **Misma imagen** (misma huella del archivo): no se procesa. La fila dice dónde está ya
 *    («Ya está como Opción 2 de Vuelo 1») y se quita sola; «Deshacer» la procesa igual.
 *  · **Mismo contenido, otra imagen** (mismo servicio, mismas fechas, mismo precio): la
 *    opción se crea y se lee, pero la fila pregunta: «Descartar» (por defecto) o «Agregar
 *    igual».
 *  · **Mismo servicio con otro precio**: no es repetido, es una cotización nueva del mismo
 *    servicio. Se ofrece reemplazar el precio de la opción que ya estaba o dejarla como otra.
 *
 * Puro: la huella se calcula con `crypto.subtle`, que existe igual en el navegador (donde se
 * pega) y en el servidor (donde se guarda con la lectura), así las dos puntas comparan lo
 * mismo.
 */

import { leerTarifaPax, camposDeIdentidad, mismoTexto, type LecturaCasilla } from './tarifa-pasajero'
import { ranuraDelItem } from './detalle-viaje'
import { leidosPorSlug } from './correcciones'

/** Una opción de la cotización tal como la tiene la bandeja (de la página o de su lectura). */
export interface OpcionComparable {
  id: string
  nombre?: string | null
  grupo?: string | null
  tarifa_pax?: unknown
}

/** Dónde vive una opción, para nombrarla: «Opción 2 de Vuelo 1 · BOG → ADZ». */
export interface Ubicacion {
  bloque: string
  opcion: number
}

/**
 * La huella de una imagen pegada: SHA-256 de su contenido en base64. Dos pegadas del mismo
 * archivo dan la misma; basta un píxel distinto para que no. `null` si no hay cómo calcularla
 * (entonces simplemente no se detecta la repetida: se procesa como siempre).
 */
export async function huellaDeImagen(dataUrl: string): Promise<string | null> {
  const m = /^data:[^;]+;base64,([\s\S]+)$/.exec(dataUrl)
  const sutil = globalThis.crypto?.subtle
  if (!m || !sutil) return null
  try {
    const bytes = new TextEncoder().encode(m[1].trim())
    const digest = await sutil.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

/** La lectura del pantallazo 1 de una opción (la que trae el servicio y el precio). */
function lecturaPrincipal(o: OpcionComparable): LecturaCasilla | null {
  return leerTarifaPax(o.tarifa_pax).casillas?.grupo_completo ?? null
}

/** ¿Alguna opción ya se leyó de esta misma imagen? Devuelve la primera. */
export function opcionConLaMismaImagen(huella: string | null, opciones: readonly OpcionComparable[]): OpcionComparable | null {
  if (!huella) return null
  for (const o of opciones) {
    const tarifa = leerTarifaPax(o.tarifa_pax)
    for (const l of Object.values(tarifa.casillas ?? {})) {
      if (l?.huellaImagen === huella) return o
    }
    // R8 · también las habitaciones de una opción de hotel (regla 6).
    for (const h of tarifa.habitaciones ?? []) {
      if (h.lectura.huellaImagen === huella) return o
    }
  }
  return null
}

const numeroDeVuelo = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * ¿Es el mismo servicio? Misma ranura, el dato principal (aerolínea, hotel, actividad,
 * trayecto) presente en las dos y coincidente, ningún otro dato de identidad que se
 * contradiga, y el número de vuelo igual si las dos lo muestran.
 *
 * ⚠️ Un dato que solo tiene una de las dos no cuenta en contra: la otra captura puede no
 * mostrarlo. Pero sin el principal en las dos no se afirma nada: sin él «parece igual» sería
 * adivinar.
 */
export function mismoServicio(a: OpcionComparable, b: OpcionComparable): boolean {
  const ra = ranuraDelItem({ nombre: a.nombre ?? null, grupo: a.grupo ?? null, tarifa_pax: a.tarifa_pax })
  const rb = ranuraDelItem({ nombre: b.nombre ?? null, grupo: b.grupo ?? null, tarifa_pax: b.tarifa_pax })
  if (!ra || !rb || ra.slug !== rb.slug) return false
  const la = lecturaPrincipal(a)
  const lb = lecturaPrincipal(b)
  if (!la || !lb) return false
  const campos = camposDeIdentidad(ra.slug)
  if (campos.length === 0) return false
  const [principal] = campos
  const pa = la.identidad[principal]
  const pb = lb.identidad[principal]
  if (!pa || !pb || !mismoTexto(pa, pb)) return false
  for (const campo of campos.slice(1)) {
    const va = la.identidad[campo]
    const vb = lb.identidad[campo]
    if (va && vb && !mismoTexto(va, vb)) return false
  }
  const na = leidosPorSlug(ra, la.campos).numero_vuelo
  const nb = leidosPorSlug(rb, lb.campos).numero_vuelo
  if (na && nb && numeroDeVuelo(na) !== numeroDeVuelo(nb)) return false
  return true
}

/** ¿Mismo precio? Misma moneda y el total a menos de una unidad. */
export function mismoPrecio(a: OpcionComparable, b: OpcionComparable): boolean {
  const la = lecturaPrincipal(a)
  const lb = lecturaPrincipal(b)
  if (!la || !lb) return false
  return la.moneda.toUpperCase() === lb.moneda.toUpperCase() && Math.abs(la.total - lb.total) < 1
}

export type Repeticion =
  | { tipo: 'parecida'; con: OpcionComparable }
  | { tipo: 'otro_precio'; con: OpcionComparable }

/**
 * Compara la opción recién leída contra las que ya había. Un «parece igual» gana sobre un
 * «otro precio»: si ya hay una idéntica, esa es la que importa.
 */
export function compararConExistentes(nueva: OpcionComparable, existentes: readonly OpcionComparable[]): Repeticion | null {
  // R8 · regla 6: en hotel, dos capturas iguales son dos habitaciones iguales (un grupo de 4
  // adultos son dos dobles), no una repetida. Lo repetido de un hotel lo deciden la misma
  // imagen o los cupos del grupo ya cubiertos (`unirHotelComoHabitacion`).
  if (ranuraDelItem({ nombre: nueva.nombre ?? null, grupo: nueva.grupo ?? null, tarifa_pax: nueva.tarifa_pax })?.slug === 'hotel_detalle') return null
  let otroPrecio: OpcionComparable | null = null
  for (const o of existentes) {
    if (o.id === nueva.id || !mismoServicio(nueva, o)) continue
    if (mismoPrecio(nueva, o)) return { tipo: 'parecida', con: o }
    otroPrecio ??= o
  }
  return otroPrecio ? { tipo: 'otro_precio', con: otroPrecio } : null
}

/**
 * Cómo se nombra una opción en la fila. Con su lugar en la cotización, «Opción 2 de Vuelo 1»;
 * si todavía no está en la página (otra captura de esta misma bandeja), lo que se sepa.
 */
export function nombreDeOpcion(itemId: string, ubicaciones: Readonly<Record<string, Ubicacion>>, etiqueta?: string | null): string {
  const u = ubicaciones[itemId]
  if (u) return `Opción ${u.opcion} de ${u.bloque}`
  return etiqueta ? `una opción de ${etiqueta}` : 'otra captura de esta bandeja'
}

/** Lo corto, para el botón: «Opción 2» o «esa opción». */
export function opcionCorta(itemId: string, ubicaciones: Readonly<Record<string, Ubicacion>>): string {
  const u = ubicaciones[itemId]
  return u ? `Opción ${u.opcion}` : 'esa opción'
}

/**
 * La fila de una imagen repetida. Con lugar conocido, «Ya está como Opción 2 de Vuelo 1»; si
 * la otra es una captura de esta misma bandeja que todavía no llegó a la página, lo dice así.
 */
export function mensajeMismaImagen(itemId: string | null, ubicaciones: Readonly<Record<string, Ubicacion>>, etiqueta?: string | null): string {
  if (itemId && ubicaciones[itemId]) return `Ya está como ${nombreDeOpcion(itemId, ubicaciones)}`
  if (etiqueta) return `Es la misma imagen que ya pegaste para ${etiqueta}`
  return 'Es la misma imagen que ya pegaste en esta bandeja'
}
