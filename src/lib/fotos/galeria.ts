/**
 * La galería de fotos de un HOTEL (Mauricio, 2026-10-16, referencia: la galería de Booking): una
 * cuadrícula de fotos grandes con pestañas Fachada · Habitaciones · Zonas comunes · Todas, donde la
 * asesora MARCA hasta 3 sin importar la categoría. El número de la marca es el orden en la
 * propuesta; la 1 es la principal.
 *
 * Lo marcado ES lo que el hotel tiene en la biblioteca (`ElementoVista.fotos`, la principal
 * primero). Una opción de Commons o de la página oficial que ya está en la biblioteca se reconoce
 * por `fuenteId` y sale marcada en su mismo lugar (marcar no mueve la cuadrícula). PURO.
 */
import { CATEGORIAS_HOTEL, type CategoriaFoto, type CategoriaHotel } from './categoria'
import { MAX_FOTOS_POR_ELEMENTO } from './clave'
import type { FotoVista, OpcionFoto } from './vista'

export type PestanaGaleria = CategoriaHotel | 'todas'
export const PESTANAS_GALERIA: readonly PestanaGaleria[] = [...CATEGORIAS_HOTEL, 'todas']

export const MENSAJE_TRES_MARCADAS = `Ya marcaste ${MAX_FOTOS_POR_ELEMENTO}: desmarca una para poner otra.`

/** Un cuadro de la galería: una opción (sin guardar) o una foto de la biblioteca (marcada). */
export interface CuadroGaleria {
  clave: string
  /** Lo que se pinta: la foto guardada si hay enlace; si no, la miniatura de la opción. */
  imagen: string | null
  categoria: CategoriaFoto | null
  origen: 'wikimedia' | 'sitio_oficial' | 'asesora'
  /** «Autora · CC BY-SA 4.0», el dominio de la página oficial, o `null` (subida). */
  credito: string | null
  /** La página donde está (Commons o la oficial). */
  pagina: string | null
  /** 1 a 3 = orden en la propuesta; `null` = sin marcar. */
  marca: number | null
  principal: boolean
  /** La foto de la biblioteca (para desmarcar o hacerla principal). */
  fotoId: string | null
  /** La opción para guardarla al marcar; `null` = la foto solo existe en la biblioteca. */
  opcion: OpcionFoto | null
}

const sinCategoria = (c: CategoriaFoto | null | undefined) => !c || c === 'otra'

/**
 * Todos los cuadros, en orden estable: primero las fotos de la biblioteca que no están entre las
 * opciones (subidas, o de antes), luego las opciones en el orden en que llegaron.
 */
export function cuadrosDelHotel(opciones: readonly OpcionFoto[], fotos: readonly FotoVista[]): CuadroGaleria[] {
  const porFuente = new Map<string, { foto: FotoVista; marca: number }>()
  fotos.slice(0, MAX_FOTOS_POR_ELEMENTO).forEach((f, i) => {
    if (f.fuenteId) porFuente.set(f.fuenteId, { foto: f, marca: i + 1 })
  })
  const ids = new Set(opciones.map((o) => o.id))
  const sueltas: CuadroGaleria[] = fotos
    .slice(0, MAX_FOTOS_POR_ELEMENTO)
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => !f.fuenteId || !ids.has(f.fuenteId))
    .map(({ f, i }) => ({
      clave: `foto:${f.id}`,
      imagen: f.url,
      categoria: f.categoria,
      origen: f.origen,
      credito: f.fuente,
      pagina: f.fuenteUrl,
      marca: i + 1,
      principal: i === 0,
      fotoId: f.id,
      opcion: null,
    }))
  const vistas = new Set<string>()
  const deOpciones: CuadroGaleria[] = []
  for (const o of opciones) {
    if (vistas.has(o.id)) continue
    vistas.add(o.id)
    const guardada = porFuente.get(o.id)
    deOpciones.push({
      clave: `opcion:${o.id}`,
      imagen: guardada?.foto.url ?? o.miniatura,
      categoria: guardada && !sinCategoria(guardada.foto.categoria) ? guardada.foto.categoria : o.categoria ?? null,
      origen: o.fuente,
      credito: o.credito,
      pagina: o.pagina,
      marca: guardada?.marca ?? null,
      principal: guardada?.marca === 1,
      fotoId: guardada?.foto.id ?? null,
      opcion: o,
    })
  }
  return [...sueltas, ...deOpciones]
}

/**
 * Lo que muestra una pestaña: los cuadros de esa categoría y, aparte, los que no tienen categoría
 * (el modelo no pudo mirarlos, o son fotos de antes): salen en todas las pestañas, con aviso. En
 * «Todas», todo junto y nada aparte.
 */
export function cuadrosDeLaPestana(cuadros: readonly CuadroGaleria[], pestana: PestanaGaleria): { propios: CuadroGaleria[]; sinClasificar: CuadroGaleria[] } {
  if (pestana === 'todas') return { propios: [...cuadros], sinClasificar: [] }
  return {
    propios: cuadros.filter((c) => c.categoria === pestana),
    sinClasificar: cuadros.filter((c) => sinCategoria(c.categoria)),
  }
}

/** La miniatura de la pestaña: lo marcado de esa categoría (la principal en «Todas»), o lo primero. */
export function portadaDeLaPestana(cuadros: readonly CuadroGaleria[], pestana: PestanaGaleria): string | null {
  const propios = cuadrosDeLaPestana(cuadros, pestana).propios.filter((c) => c.imagen)
  const marcados = propios.filter((c) => c.marca !== null).sort((a, b) => (a.marca ?? 9) - (b.marca ?? 9))
  return (marcados[0] ?? propios[0])?.imagen ?? null
}

/** ¿Cabe otra marca? */
export function cabeOtraMarca(fotos: readonly unknown[]): boolean {
  return fotos.length < MAX_FOTOS_POR_ELEMENTO
}

/**
 * La categoría con la que se guarda lo que se marca o se sube: la que vio el modelo; si no la
 * hay, la de la pestaña; en «Todas», sin categoría (la clasifica el modelo al volver a abrir).
 */
export function categoriaAlMarcar(cuadro: Pick<CuadroGaleria, 'categoria'> | null, pestana: PestanaGaleria): CategoriaHotel | null {
  const c = cuadro?.categoria
  if (c && c !== 'otra') return c
  return pestana === 'todas' ? null : pestana
}
