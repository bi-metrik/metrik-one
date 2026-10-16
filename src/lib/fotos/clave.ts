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
 *  · `wikimedia`: Wikimedia Commons (CC0, CC BY, CC BY-SA), con crédito;
 *  · `asesora`: la subió una persona («Subir la mía»);
 *  · `sitio_oficial`: la página oficial del hotel o del tour. Solo con el interruptor del
 *    workspace (`usaFotosDeSitioOficial`), apagado por defecto: Emilio no ha validado su uso
 *    comercial (2026-10-16).
 */
export type OrigenFoto = 'wikimedia' | 'asesora' | 'sitio_oficial'

/** Hasta tres fotos por elemento en la biblioteca, una principal (Mauricio, 2026-10-16). */
export const MAX_FOTOS_POR_ELEMENTO = 3

/** Cuántas opciones muestra el selector por tanda («Ver más» trae las siguientes). */
export const OPCIONES_POR_PAGINA = 12

/** La propuesta imprime la principal y, si caben, hasta estas más. */
export const MAX_FOTOS_EXTRA = MAX_FOTOS_POR_ELEMENTO - 1

/**
 * ¿Se le busca foto SOLA (sin que nadie la elija) en Wikimedia Commons? Las ciudades y las
 * actividades sí; los hoteles NUNCA (Mauricio, 2026-10-14 y 2026-10-16: «siempre los elige una
 * persona»). Un hotel lleva la que alguien eligió en la biblioteca (de cualquier fuente) o el
 * degradado.
 */
export function seSugiereDeCommons(tipo: TipoFoto): boolean {
  return tipo !== 'hotel'
}

/**
 * El interruptor de las fotos de la página oficial: `config_extra.documento_viaje.fotos_sitio_oficial
 * = true`. Sin él (el valor por defecto), ni se ofrecen ni se imprimen las que hubiera.
 */
export function usaFotosDeSitioOficial(configExtraWorkspace: unknown): boolean {
  if (!configExtraWorkspace || typeof configExtraWorkspace !== 'object') return false
  const doc = (configExtraWorkspace as Record<string, unknown>).documento_viaje
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false
  return (doc as Record<string, unknown>).fotos_sitio_oficial === true
}

/** Las fuentes del selector de 12, en el orden de Mauricio: la página oficial, Commons y la propia. */
export type FuenteFoto = 'sitio_oficial' | 'wikimedia' | 'subida'

export function fuentesDelSelector(sitioOficial: boolean): FuenteFoto[] {
  return sitioOficial ? ['sitio_oficial', 'wikimedia', 'subida'] : ['wikimedia', 'subida']
}

/**
 * ¿Esta foto de la biblioteca sale en la propuesta?
 *  · una de la página oficial, solo con el interruptor encendido;
 *  · la de un hotel, solo si una persona la eligió (`revisada`, o la subió ella): nunca una
 *    automática;
 *  · las demás, siempre.
 */
export function fotoImprimible(
  tipo: TipoFoto,
  origen: OrigenFoto | null | undefined,
  revisada: boolean | null | undefined,
  opts: { sitioOficial?: boolean } = {},
): boolean {
  if (origen === 'sitio_oficial' && !opts.sitioOficial) return false
  return tipo === 'hotel' ? revisada === true || origen === 'asesora' : true
}
