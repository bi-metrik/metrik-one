/**
 * Lo que la pantalla «Hoteles y tours» y la tarjeta de la cotización ven de una foto y de un
 * perfil. PURO: de las filas del catálogo (`FilaCatalogo`) a lo que viaja al navegador, sin rutas
 * del bucket ni ids de staff.
 */
import type { CategoriaFoto } from './categoria'
import { formaAdmitida } from './forma'
import { fotoImprimible, MAX_FOTOS_POR_ELEMENTO, objetivo, TIPOS_FOTO, type ObjetivoFoto, type OrigenFoto, type TipoFoto } from './clave'

export interface FotoVista {
  id: string
  /** Enlace firmado corto; `null` = no se pudo firmar (se ve el degradado). */
  url: string | null
  principal: boolean
  origen: OrigenFoto
  /** «Autora · CC BY-SA 4.0» (Commons, de antes) o `null` (propia). */
  fuente: string | null
  /** ¿Sale en la propuesta? (una de la página oficial no; un hotel que nadie eligió no; un collage o una vertical de hotel no). */
  seImprime: boolean
  /**
   * Hotel con forma de collage o de foto vertical (`formaAdmitida`, regla del 2026-10-29): queda en
   * la biblioteca, marcada, y el documento no la usa.
   */
  collageOVertical?: boolean
  /** Hotel: fachada, habitación, zonas comunes u otra; `null` sin categoría. */
  categoria: CategoriaFoto | null
}

/** Otro nombre del mismo perfil («Hotel Catalonia Puerta del Sol Madrid»). */
export interface AliasVista {
  id: string
  nombre: string
  ciudad: string | null
}

export interface ElementoVista {
  tipo: TipoFoto
  /** La llave del perfil (donde viven las fotos). */
  clave: string
  nombre: string
  ciudad: string | null
  fotos: FotoVista[]
  /** ¿Cabe otra foto? (hasta `MAX_FOTOS_POR_ELEMENTO`). */
  admiteOtra: boolean
  /** Los otros nombres con que llegó este hotel o tour. */
  alias: AliasVista[]
}

/**
 * «¿Es el mismo hotel que …?»: el nombre de la cotización se parece a uno que el espacio ya conoce
 * y la persona decide. `clave` es la del perfil conocido.
 */
export interface DudaVista {
  clave: string
  nombre: string
  ciudad: string | null
  /** La principal del perfil conocido, para reconocerlo de un vistazo. */
  url: string | null
}

interface FilaParaVista {
  id: string
  ref: string
  origen: OrigenFoto
  autor: string | null
  licencia: string | null
  revisada: boolean
  categoria?: CategoriaFoto | null
  proporcion?: number | string | null
}

function fuenteDeFila(f: Pick<FilaParaVista, 'origen' | 'autor' | 'licencia'>): string | null {
  if (f.origen === 'wikimedia') return [f.autor, f.licencia].filter(Boolean).join(' · ') || 'Wikimedia Commons'
  if (f.origen === 'sitio_oficial') return 'Página oficial'
  return null
}

/** Un elemento (perfil o ciudad) con sus fotos YA ordenadas (la principal primero). */
export function vistaDeElemento(
  e: { tipo: TipoFoto; clave: string; nombre: string; ciudad: string | null; fotos: FilaParaVista[]; alias?: AliasVista[] },
  urls: Map<string, string>,
): ElementoVista {
  return {
    tipo: e.tipo,
    clave: e.clave,
    nombre: e.nombre,
    ciudad: e.ciudad,
    admiteOtra: e.fotos.length < MAX_FOTOS_POR_ELEMENTO,
    alias: e.alias ?? [],
    fotos: e.fotos.slice(0, MAX_FOTOS_POR_ELEMENTO).map((f, i) => {
      const collageOVertical = e.tipo === 'hotel' && !formaAdmitida(f.proporcion === null || f.proporcion === undefined ? null : Number(f.proporcion))
      return {
        id: f.id,
        url: urls.get(f.ref) ?? null,
        // La primera del orden es la principal aunque la fila no lo diga (código anterior).
        principal: i === 0,
        origen: f.origen,
        fuente: fuenteDeFila(f),
        seImprime: fotoImprimible(e.tipo, f.origen, f.revisada) && !collageOVertical,
        collageOVertical,
        categoria: f.categoria ?? null,
      }
    }),
  }
}

/**
 * Lo que la tarjeta muestra del perfil: la foto que sale en la propuesta (la principal si se
 * imprime; si no, la primera que sí, igual que el documento) y cuántas más salen con ella («+2»).
 * Sin ninguna imprimible, el recuadro queda vacío: «Agrega fotos de este hotel».
 */
export function fotoDeLaTarjeta(e: ElementoVista | null | undefined): { foto: FotoVista | null; mas: number; admiteOtra: boolean } {
  const imprimibles = (e?.fotos ?? []).filter((f) => f.seImprime)
  return { foto: imprimibles[0] ?? null, mas: Math.max(0, imprimibles.length - 1), admiteOtra: e ? e.admiteOtra : true }
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
