/**
 * Lo que la pantalla de la biblioteca y el selector ven de una foto. PURO: de las filas del
 * catálogo (`FilaCatalogo`) a lo que viaja al navegador, sin rutas del bucket ni ids de staff.
 */
import { fotoImprimible, MAX_FOTOS_POR_ELEMENTO, objetivo, TIPOS_FOTO, type ObjetivoFoto, type OrigenFoto, type TipoFoto } from './clave'

export interface FotoVista {
  id: string
  /** Enlace firmado corto; `null` = no se pudo firmar (se ve el degradado). */
  url: string | null
  principal: boolean
  posicion: number
  origen: OrigenFoto
  /** «Autora · CC BY-SA 4.0», «hotel.com» o `null` (propia). */
  fuente: string | null
  /** La página de donde salió (Commons o el sitio oficial). */
  fuenteUrl: string | null
  revisada: boolean
  /** ¿Sale en la propuesta? (un hotel sin elegir no; una del sitio oficial con el interruptor apagado no). */
  seImprime: boolean
}

export interface ElementoVista {
  tipo: TipoFoto
  clave: string
  nombre: string
  ciudad: string | null
  fotos: FotoVista[]
  /** ¿Cabe otra foto? (hasta `MAX_FOTOS_POR_ELEMENTO`). */
  admiteOtra: boolean
}

/** Una de las 12 opciones del selector. Nada de esto se guarda hasta que la persona la elige. */
export interface OpcionFoto {
  /** Identifica la opción en la cuadrícula. */
  id: string
  fuente: 'wikimedia' | 'sitio_oficial'
  miniatura: string
  ancho: number
  alto: number
  /** Título del archivo en Commons, o la URL de la imagen en el sitio oficial. */
  titulo: string
  /** «Autora · CC BY-SA 4.0» o el dominio del sitio. */
  credito: string | null
  /** La página donde está. */
  pagina: string
  /** Sitio oficial: la URL de la imagen. */
  imagen?: string
}

/** Lo que el navegador manda al elegir: SOLO cómo encontrarla; el servidor revalida todo. */
export type EleccionFoto = { fuente: 'wikimedia'; titulo: string } | { fuente: 'sitio_oficial'; pagina: string; imagen: string }

interface FilaParaVista {
  id: string
  tipo: TipoFoto
  clave: string
  nombre: string
  ciudad: string | null
  ref: string
  origen: OrigenFoto
  fuente_url: string | null
  autor: string | null
  licencia: string | null
  revisada: boolean
  principal: boolean
  posicion: number
}

export function dominio(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : null
  } catch {
    return null
  }
}

export function fuenteDeFila(f: Pick<FilaParaVista, 'origen' | 'autor' | 'licencia' | 'fuente_url'>): string | null {
  if (f.origen === 'wikimedia') return [f.autor, f.licencia].filter(Boolean).join(' · ') || 'Wikimedia Commons'
  if (f.origen === 'sitio_oficial') return dominio(f.fuente_url)
  return null
}

export function vistaDeElemento(
  e: { tipo: TipoFoto; clave: string; nombre: string; ciudad: string | null; fotos: FilaParaVista[] },
  urls: Map<string, string>,
  opts: { sitioOficial: boolean },
): ElementoVista {
  return {
    tipo: e.tipo,
    clave: e.clave,
    nombre: e.nombre,
    ciudad: e.ciudad,
    admiteOtra: e.fotos.length < MAX_FOTOS_POR_ELEMENTO,
    fotos: e.fotos.slice(0, MAX_FOTOS_POR_ELEMENTO).map((f, i) => ({
      id: f.id,
      url: urls.get(f.ref) ?? null,
      // La primera del orden es la principal aunque la fila no lo diga (código anterior).
      principal: i === 0,
      posicion: f.posicion ?? 1,
      origen: f.origen,
      fuente: fuenteDeFila(f),
      fuenteUrl: f.fuente_url,
      revisada: f.revisada,
      seImprime: fotoImprimible(e.tipo, f.origen, f.revisada, opts),
    })),
  }
}

/**
 * Lo que el navegador pide (tipo, nombre, ciudad) como objetivo del catálogo, revisado. La llave
 * la calcula el servidor, nunca el navegador. `null` si no sirve.
 */
export function objetivoDelPedido(p: unknown): ObjetivoFoto | null {
  if (!p || typeof p !== 'object') return null
  const { tipo, nombre, ciudad } = p as Record<string, unknown>
  if (typeof tipo !== 'string' || !(TIPOS_FOTO as readonly string[]).includes(tipo)) return null
  if (typeof nombre !== 'string' || nombre.trim().length === 0 || nombre.length > 200) return null
  if (ciudad !== null && ciudad !== undefined && (typeof ciudad !== 'string' || ciudad.length > 120)) return null
  return objetivo(tipo as TipoFoto, nombre, typeof ciudad === 'string' ? ciudad : null)
}
