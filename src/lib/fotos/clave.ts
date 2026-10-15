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

export type OrigenFoto = 'wikimedia' | 'asesora'

/**
 * ¿Se le busca foto en Wikimedia Commons? Las ciudades y las actividades sí; los hoteles NUNCA
 * (Mauricio, 2026-10-14: «las de los hoteles sí las debe cargar»). Un hotel lleva la foto que
 * sube la asesora o el degradado.
 */
export function seSugiereDeCommons(tipo: TipoFoto): boolean {
  return tipo !== 'hotel'
}

/**
 * ¿Esta foto del catálogo sale en la propuesta? La de un hotel, solo si la subió la asesora: una
 * de Commons que hubiera quedado en el catálogo no se imprime. Las demás, siempre.
 */
export function fotoImprimible(tipo: TipoFoto, origen: OrigenFoto | null | undefined): boolean {
  return tipo === 'hotel' ? origen === 'asesora' : true
}
