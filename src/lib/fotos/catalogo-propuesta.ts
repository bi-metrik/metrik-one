import 'server-only'

/**
 * Las fotos de la biblioteca que necesita UN documento: las de sus ciudades, sus hoteles y sus
 * planes opcionales, por la llave que nombra la cotización. La llave puede ser un alias del perfil
 * («Hotel Catalonia Puerta del Sol Madrid» → las fotos de «Catalonia Puerta del Sol»): la vista
 * `fotos_catalogo_por_clave` lo resuelve en la MISMA ida a la base. Sin filas (o sin la migración)
 * el documento sale como antes.
 */
import type { CotizacionPDFProps } from '@/lib/pdf/cotizacion-props'
import type { CatalogoPropuesta, FotoDeCatalogo } from '@/lib/pdf/html/propuesta-html'
import { creditoDeFila, dataUrlDeFila, fotosDe, leerCatalogo, type FilaCatalogo } from './catalogo'
import { claveDeFoto, fotoImprimible, MAX_FOTOS_EXTRA, nombreLlano, objetivo, sinRepetir, type ObjetivoFoto } from './clave'
import { formaPosible, ordenarPorCategoria } from './forma'

/**
 * Las fotos de una llave que pueden salir en el documento, en su orden. Las de un hotel, además,
 * sin collages irregulares ni verticales (`formaPosible`: quedan en la biblioteca, marcadas, pero no
 * se imprimen; una de paneles iguales la confirma el PDF con los píxeles) y por categoría: fachada → habitación → zonas comunes (regla de fotos, 2026-10-29).
 */
export function fotosParaElDocumento(filas: FilaCatalogo[], o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): FilaCatalogo[] {
  const todas = fotosDe(filas, o)
  return o.tipo === 'hotel' ? ordenarPorCategoria(todas.filter((f) => formaPosible(f.proporcion))) : todas
}

/**
 * La ficha FIJADA en la línea de cada hotel (`items.proveedor_id`): llave del hotel en el documento
 * (`claveDeFoto('hotel', hotel, ciudad)`) → llave del perfil de la ficha. Es lo que la tarjeta usa
 * para mostrar y subir las fotos (`fotosParaTarjetas`, por id): sin esto el documento las buscaba
 * por el nombre leído y no las encontraba si la llave de la ficha era otra (reunión del 2026-10-22,
 * punto 3: los hoteles salían sin foto).
 */
export type FichasDeHotel = ReadonlyMap<string, string>

type HotelDelDocumento = { hotel: string | null; linea: string; ciudad: string | null }

/**
 * Las llaves donde buscar las fotos de un hotel, en orden: la de su ficha fijada, la suya, y las de
 * los hoteles del documento con el MISMO nombre (con su ficha). Lo último es porque el motor html
 * pregunta por la ciudad del CAPÍTULO, no por la del hotel (`ciudadDeCapitulo`): una alternativa de
 * otra zona en el mismo capítulo («Playa del Carmen» dentro de «Cancún») se quedaba sin foto.
 */
function clavesDeHotel(hotel: string, ciudad: string | null, hoteles: readonly HotelDelDocumento[], fichas: FichasDeHotel): string[] {
  const propia = claveDeFoto('hotel', hotel, ciudad)
  const nombre = nombreLlano(hotel)
  const mismos = hoteles.filter((h) => nombreLlano(h.hotel ?? h.linea) === nombre).map((h) => claveDeFoto('hotel', h.hotel ?? h.linea, h.ciudad))
  const salida: string[] = []
  for (const k of [propia, ...mismos]) {
    const ficha = fichas.get(k)
    if (ficha) salida.push(ficha)
    if (k) salida.push(k)
  }
  return [...new Set(salida)]
}

/** Los objetivos de los hoteles: por su nombre y, si su línea fijó una ficha, por la ficha. */
function objetivosDeHoteles(hoteles: readonly HotelDelDocumento[], fichas: FichasDeHotel): (ObjetivoFoto | null)[] {
  return hoteles.flatMap((h) => {
    const propio = objetivo('hotel', h.hotel ?? h.linea, h.ciudad)
    const ficha = propio ? fichas.get(propio.clave) : undefined
    return ficha && propio ? [{ ...propio, clave: ficha }, propio] : [propio]
  })
}

/** Un plan opcional del documento con la ciudad de su línea (la misma llave que su tarjeta). */
export interface OpcionalDelDocumento {
  nombre: string
  ciudad: string | null
}

/** Las llaves de los planes opcionales, por el nombre que imprime el documento. */
function clavesDeOpcionales(opcionales: readonly OpcionalDelDocumento[]): Map<string, ObjetivoFoto> {
  const m = new Map<string, ObjetivoFoto>()
  for (const o of opcionales) {
    const x = objetivo('actividad', o.nombre, o.ciudad)
    if (x && !m.has(o.nombre)) m.set(o.nombre, x)
  }
  return m
}

/**
 * El catálogo que pide UNA propuesta del motor html: por elemento, la principal y hasta dos más
 * (`extras`). Solo lo imprimible (`fotoImprimible`): un hotel con la foto que eligió una persona;
 * nunca una de la página oficial. Si la principal no se imprime, la primera extra que sí ocupa su
 * lugar.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function catalogoParaLaPropuesta(supabase: any, workspaceId: string, props: CotizacionPDFProps, opcionales: readonly OpcionalDelDocumento[] = [], fichas: FichasDeHotel = new Map()): Promise<CatalogoPropuesta | null> {
  const hoteles = props.viaje?.hoteles ?? []
  const deOpcionales = clavesDeOpcionales(opcionales)
  const objetivos = sinRepetir([
    ...hoteles.map((h) => objetivo('ciudad', h.ciudad)),
    ...objetivosDeHoteles(hoteles, fichas),
    ...deOpcionales.values(),
  ])
  const filas = (await leerCatalogo(supabase, workspaceId, objetivos.map((o) => o.clave))).filter((f) => fotoImprimible(f.tipo, f.origen, f.revisada))
  if (filas.length === 0) return null
  const leidas = new Map<string, FotoDeCatalogo>()
  await Promise.all(
    [...new Map(filas.map((f) => [f.id, f])).values()].map(async (f) => {
      const src = await dataUrlDeFila(workspaceId, f)
      if (src) {
        leidas.set(f.id, {
          src,
          origen: f.origen,
          revisada: f.revisada,
          credito: creditoDeFila(f),
          foco: f.foco_x !== null && f.foco_y !== null ? { x: Number(f.foco_x), y: Number(f.foco_y) } : null,
          proporcion: f.proporcion === null || f.proporcion === undefined ? null : Number(f.proporcion),
          categoria: f.categoria ?? null,
        })
      }
    }),
  )
  /** La principal de la llave con sus extras, todas ya leídas. */
  const de = (o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): FotoDeCatalogo | null => {
    const todas = fotosParaElDocumento(filas, o).map((f) => leidas.get(f.id)).filter((x): x is FotoDeCatalogo => !!x)
    if (todas.length === 0) return null
    const [primera, ...resto] = todas
    return resto.length > 0 ? { ...primera, extras: resto.slice(0, MAX_FOTOS_EXTRA) } : primera
  }
  return {
    ciudad: (ciudad) => de({ tipo: 'ciudad', clave: claveDeFoto('ciudad', ciudad) }),
    hotel: (hotel, ciudad) => {
      for (const clave of clavesDeHotel(hotel, ciudad, hoteles, fichas)) {
        const f = de({ tipo: 'hotel', clave })
        if (f) return f
      }
      return null
    },
    actividad: (nombre) => {
      const o = deOpcionales.get(nombre)
      return o ? de(o) : null
    },
  }
}

/**
 * Las fotos de hotel y de plan opcional de la biblioteca para el documento (los dos motores; ver
 * `foto-hotel-documento.ts`): por llave, la primera imprimible (la principal si se imprime). El
 * motor html la usa para saber que NO va la foto vieja de la opción; @react-pdf además la imprime.
 * Una sola ida a la base.
 */
export async function fotosDeBibliotecaDelDocumento(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  hoteles: { hotel: string | null; linea: string; ciudad: string | null }[],
  opcionales: readonly OpcionalDelDocumento[] = [],
  fichas: FichasDeHotel = new Map(),
) {
  const propios = sinRepetir(hoteles.map((h) => objetivo('hotel', h.hotel ?? h.linea, h.ciudad)))
  const deHoteles = sinRepetir(objetivosDeHoteles(hoteles, fichas))
  const deOpcionales = clavesDeOpcionales(opcionales)
  const objetivos = sinRepetir([...deHoteles, ...deOpcionales.values()])
  const mapa = new Map<string, { proporcion: number | null; credito: string | null }>()
  const porClave = new Map<string, FilaCatalogo>()
  if (objetivos.length > 0) {
    const filas = (await leerCatalogo(supabase, workspaceId, objetivos.map((o) => o.clave))).filter((f) => fotoImprimible(f.tipo, f.origen, f.revisada))
    // Cada hotel bajo SU llave del documento (la que pide `fotosDeHotelesDelDocumento`), con la foto
    // de su ficha fijada si la tiene y, si no, la de su nombre.
    for (const o of [...propios, ...deOpcionales.values()]) {
      const ficha = o.tipo === 'hotel' ? fichas.get(o.clave) : undefined
      const primera = (x: Pick<ObjetivoFoto, 'tipo' | 'clave'>) => fotosParaElDocumento(filas, x)[0] ?? null
      const f = (ficha ? primera({ tipo: 'hotel', clave: ficha }) : null) ?? primera(o)
      if (!f) continue
      porClave.set(`${o.tipo}:${o.clave}`, f)
      mapa.set(`${o.tipo}:${o.clave}`, {
        proporcion: f.proporcion === null || f.proporcion === undefined ? null : Number(f.proporcion),
        // El crédito de Commons (fotos de antes) tiene que salir en el PDF de @react-pdf también.
        credito: creditoDeFila(f),
      })
    }
  }
  const leer = async (k: string) => {
    const f = porClave.get(k)
    return f ? dataUrlDeFila(workspaceId, f) : null
  }
  return {
    /** Por llave del hotel (`hotel|ciudad`): la foto imprimible, su proporción y su crédito. */
    hoteles: new Map([...mapa].filter(([k]) => k.startsWith('hotel:')).map(([k, v]) => [k.slice('hotel:'.length), v])),
    leerHotel: (clave: string) => leer(`hotel:${clave}`),
    /** La foto de un plan opcional por el nombre que imprime el documento. */
    opcional: async (nombre: string): Promise<{ url: string; proporcion: number | null; credito: string | null } | null> => {
      const o = deOpcionales.get(nombre)
      const datos = o ? mapa.get(`actividad:${o.clave}`) : undefined
      if (!o || !datos) return null
      const url = await leer(`actividad:${o.clave}`)
      return url ? { url, ...datos } : null
    },
  }
}
