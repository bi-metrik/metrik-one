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
import { creditoDeFila, dataUrlDeFila, filaDe, fotosDe, leerCatalogo, type FilaCatalogo } from './catalogo'
import { claveDeFoto, fotoImprimible, MAX_FOTOS_EXTRA, objetivo, sinRepetir, type ObjetivoFoto } from './clave'

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
export async function catalogoParaLaPropuesta(supabase: any, workspaceId: string, props: CotizacionPDFProps, opcionales: readonly OpcionalDelDocumento[] = []): Promise<CatalogoPropuesta | null> {
  const hoteles = props.viaje?.hoteles ?? []
  const deOpcionales = clavesDeOpcionales(opcionales)
  const objetivos = sinRepetir([
    ...hoteles.map((h) => objetivo('ciudad', h.ciudad)),
    ...hoteles.map((h) => objetivo('hotel', h.hotel ?? h.linea, h.ciudad)),
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
        })
      }
    }),
  )
  /** La principal de la llave con sus extras, todas ya leídas. */
  const de = (o: Pick<ObjetivoFoto, 'tipo' | 'clave'>): FotoDeCatalogo | null => {
    const todas = fotosDe(filas, o).map((f) => leidas.get(f.id)).filter((x): x is FotoDeCatalogo => !!x)
    if (todas.length === 0) return null
    const [primera, ...resto] = todas
    return resto.length > 0 ? { ...primera, extras: resto.slice(0, MAX_FOTOS_EXTRA) } : primera
  }
  return {
    ciudad: (ciudad) => de({ tipo: 'ciudad', clave: claveDeFoto('ciudad', ciudad) }),
    hotel: (hotel, ciudad) => de({ tipo: 'hotel', clave: claveDeFoto('hotel', hotel, ciudad) }),
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
) {
  const deHoteles = sinRepetir(hoteles.map((h) => objetivo('hotel', h.hotel ?? h.linea, h.ciudad)))
  const deOpcionales = clavesDeOpcionales(opcionales)
  const objetivos = sinRepetir([...deHoteles, ...deOpcionales.values()])
  const mapa = new Map<string, { proporcion: number | null; credito: string | null }>()
  const porClave = new Map<string, FilaCatalogo>()
  if (objetivos.length > 0) {
    const filas = (await leerCatalogo(supabase, workspaceId, objetivos.map((o) => o.clave))).filter((f) => fotoImprimible(f.tipo, f.origen, f.revisada))
    for (const o of objetivos) {
      const f = filaDe(filas, o)
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
