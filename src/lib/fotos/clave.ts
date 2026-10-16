/**
 * Las llaves del catálogo de fotos (`fotos_catalogo`, PR 4 de la propuesta). Puro.
 *
 * Una foto se guarda una vez por workspace y se reusa en cada cotización que nombra lo mismo:
 *   · ciudad    → «barcelona»
 *   · hotel     → «h10 metropolitan|barcelona»
 *   · actividad → «sagrada familia|barcelona» (sin ciudad: «sagrada familia|»)
 *
 * La ciudad pasa por `claveDeCiudad` (la misma de los capítulos del documento: «Madrid MAD»,
 * «MADRID» y «Madrid, España» son la misma). El nombre, sin tildes, en minúscula y con un
 * espacio entre palabras.
 */
import { claveDeCiudad } from '@/lib/pdf/cotizacion-trappvel-formato'

export type TipoFoto = 'ciudad' | 'hotel' | 'actividad'

export const TIPOS_FOTO: readonly TipoFoto[] = ['ciudad', 'hotel', 'actividad']

/** Sin tildes, minúscula, sin signos sueltos, un espacio entre palabras. */
export function nombreLlano(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** La llave de una foto. Vacía (`''`) si no hay con qué nombrarla. */
export function claveDeFoto(tipo: TipoFoto, nombre: string | null | undefined, ciudad?: string | null): string {
  if (tipo === 'ciudad') return claveDeCiudad(nombre ?? '').toLowerCase()
  const n = nombreLlano(nombre)
  if (!n) return ''
  return `${n}|${claveDeCiudad(ciudad ?? '').toLowerCase()}`
}

/** Lo que una cotización necesita del catálogo: qué foto, con qué nombre y en qué ciudad. */
export interface ObjetivoFoto {
  tipo: TipoFoto
  clave: string
  nombre: string
  ciudad: string | null
}

export function objetivo(tipo: TipoFoto, nombre: string | null | undefined, ciudad?: string | null): ObjetivoFoto | null {
  const limpio = (nombre ?? '').trim()
  const clave = claveDeFoto(tipo, limpio, ciudad)
  if (!limpio || !clave) return null
  return { tipo, clave, nombre: limpio, ciudad: tipo === 'ciudad' ? limpio : ciudad?.trim() || null }
}

/** Sin repetidos (misma llave), en el orden en que llegan. */
export function sinRepetir(objetivos: (ObjetivoFoto | null)[]): ObjetivoFoto[] {
  const vistos = new Set<string>()
  const salida: ObjetivoFoto[] = []
  for (const o of objetivos) {
    if (!o) continue
    const k = `${o.tipo}:${o.clave}`
    if (vistos.has(k)) continue
    vistos.add(k)
    salida.push(o)
  }
  return salida
}

/**
 * De dónde salió una foto:
 *  · `asesora`: la subió o la pegó una persona (con la casilla de autorización desde 2026-10-16);
 *  · `wikimedia`: de Wikimedia Commons, con autor y licencia (CC0, CC BY, CC BY-SA). La búsqueda
 *    automática se quitó el 2026-10-16 (Mauricio): ya no entran nuevas, las que quedaron se
 *    imprimen con su crédito;
 *  · `sitio_oficial`: de la página oficial del hotel (detrás de un interruptor que nunca se
 *    encendió). Ya no entran y NO se imprimen: Emilio no validó su uso comercial.
 */
export type OrigenFoto = 'wikimedia' | 'asesora' | 'sitio_oficial'

/**
 * Hasta tres fotos por hotel o tour, una principal (Mauricio, 2026-10-16). Las tres salen en la
 * propuesta: la principal siempre y las otras dos si caben en su recuadro. No hay un segundo nivel
 * de «elegidas»: lo que está en el perfil es lo que sale.
 */
export const MAX_FOTOS_POR_ELEMENTO = 3

/** La propuesta imprime la principal y, si caben, hasta estas más. */
export const MAX_FOTOS_EXTRA = MAX_FOTOS_POR_ELEMENTO - 1

/**
 * ¿Esta foto de la biblioteca sale en la propuesta?
 *  · una de la página oficial, nunca;
 *  · la de un hotel, solo si una persona la eligió (`revisada`, o la subió ella);
 *  · las demás, siempre.
 */
export function fotoImprimible(tipo: TipoFoto, origen: OrigenFoto | null | undefined, revisada: boolean | null | undefined): boolean {
  if (origen === 'sitio_oficial') return false
  return tipo === 'hotel' ? revisada === true || origen === 'asesora' : true
}

/**
 * El crédito que imprime el documento para una foto de la biblioteca (`null` = propia, sin
 * crédito). Las de Wikimedia Commons que quedaron de antes llevan autor y licencia: «Sagrada
 * Familia, Enric (Wikimedia Commons, CC BY 4.0)».
 */
export function creditoDeFoto(f: { nombre: string; autor: string | null; licencia: string | null; origen: OrigenFoto }): string | null {
  if (f.origen !== 'wikimedia' || !f.autor || !f.licencia) return null
  return `${f.nombre}, ${f.autor} (Wikimedia Commons, ${f.licencia})`
}

/** Lo que tiene perfil (pantalla «Hoteles y tours»): los hoteles y los tours o planes. Las ciudades no. */
export type TipoPerfil = 'hotel' | 'actividad'

export function esTipoPerfil(t: unknown): t is TipoPerfil {
  return t === 'hotel' || t === 'actividad'
}
