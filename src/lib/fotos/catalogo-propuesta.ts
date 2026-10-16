import 'server-only'

/**
 * El catálogo de fotos que necesita UNA propuesta (motor `html`): lee las filas de sus ciudades,
 * hoteles y planes opcionales, baja los archivos y devuelve las búsquedas que usa
 * `prepararPropuestaHtml`. Sin filas (o sin la migración) devuelve `null` y el documento sale
 * como antes.
 */
import type { CotizacionPDFProps } from '@/lib/pdf/cotizacion-props'
import type { CatalogoPropuesta, FotoDeCatalogo } from '@/lib/pdf/html/propuesta-html'
import { actividadPorNombre, creditoDeFila, dataUrlDeFila, filaDe, fotosDe, leerCatalogo, type FilaCatalogo } from './catalogo'
import { claveDeFoto, fotoImprimible, MAX_FOTOS_EXTRA, objetivo, sinRepetir, usaFotosDeSitioOficial } from './clave'

/** Lo que una propuesta pide al catálogo, de las mismas props que imprime el documento. */
export function pedidoDeLaPropuesta(props: CotizacionPDFProps) {
  const hoteles = props.viaje?.hoteles ?? []
  const objetivos = sinRepetir([
    ...hoteles.map((h) => objetivo('ciudad', h.ciudad)),
    ...hoteles.map((h) => objetivo('hotel', h.hotel ?? h.linea, h.ciudad)),
  ])
  const nombresDeActividad = (props.sugeridos ?? []).map((s) => s.nombre)
  const claveCiudades = [...new Set(hoteles.map((h) => claveDeFoto('ciudad', h.ciudad)).filter(Boolean))]
  return { objetivos, nombresDeActividad, claveCiudades }
}

/** ¿El workspace tiene encendidas las fotos de la página oficial? Sin poder leerlo, no. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sitioOficialEncendido(supabase: any, workspaceId: string): Promise<boolean> {
  try {
    const { data } = await supabase.from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle()
    return usaFotosDeSitioOficial((data as { config_extra?: unknown } | null)?.config_extra)
  } catch {
    return false
  }
}

/**
 * El catálogo que pide UNA propuesta: por elemento, la principal y hasta dos más (`extras`). Solo
 * lo imprimible (`fotoImprimible`): un hotel con la foto que eligió una persona; una de la página
 * oficial, solo con el interruptor encendido. Si la principal no se imprime, la primera extra que
 * sí ocupa su lugar.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function catalogoParaLaPropuesta(supabase: any, workspaceId: string, props: CotizacionPDFProps): Promise<CatalogoPropuesta | null> {
  const pedido = pedidoDeLaPropuesta(props)
  const sitioOficial = await sitioOficialEncendido(supabase, workspaceId)
  const filas = (await leerCatalogo(supabase, workspaceId, pedido)).filter((f) => fotoImprimible(f.tipo, f.origen, f.revisada, { sitioOficial }))
  if (filas.length === 0) return null
  const leidas = new Map<string, FotoDeCatalogo>()
  await Promise.all(
    filas.map(async (f) => {
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
  /** La principal del elemento con sus extras, todas ya leídas. */
  const de = (principal: FilaCatalogo | null): FotoDeCatalogo | null => {
    if (!principal) return null
    const todas = fotosDe(filas, principal).map((f) => leidas.get(f.id)).filter((x): x is FotoDeCatalogo => !!x)
    if (todas.length === 0) return null
    const [primera, ...resto] = todas
    return resto.length > 0 ? { ...primera, extras: resto.slice(0, MAX_FOTOS_EXTRA) } : primera
  }
  return {
    ciudad: (ciudad) => de(filaDe(filas, { tipo: 'ciudad', clave: claveDeFoto('ciudad', ciudad) })),
    hotel: (hotel, ciudad) => de(filaDe(filas, { tipo: 'hotel', clave: claveDeFoto('hotel', hotel, ciudad) })),
    actividad: (nombre) => de(actividadPorNombre(filas, nombre, pedido.claveCiudades)),
  }
}

/**
 * Las fotos de hotel de la biblioteca para el documento (`foto-hotel-documento.ts`): por llave
 * `hotel|ciudad`, la primera imprimible (la principal si se imprime). Sirve a los dos motores: el
 * html la usa para saber que NO va la foto vieja de la opción; @react-pdf además la imprime.
 */
export async function hotelesEnBiblioteca(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  hoteles: { hotel: string | null; linea: string; ciudad: string | null }[],
  /** El `config_extra` del workspace que quien llama ya leyó (una ida menos a la base). */
  configExtraWorkspace: unknown,
) {
  const objetivos = sinRepetir(hoteles.map((h) => objetivo('hotel', h.hotel ?? h.linea, h.ciudad)))
  const mapa = new Map<string, { proporcion: number | null }>()
  const porClave = new Map<string, FilaCatalogo>()
  if (objetivos.length > 0) {
    const sitioOficial = usaFotosDeSitioOficial(configExtraWorkspace)
    const filas = (await leerCatalogo(supabase, workspaceId, { objetivos })).filter(
      (f) => f.tipo === 'hotel' && fotoImprimible(f.tipo, f.origen, f.revisada, { sitioOficial }),
    )
    for (const o of objetivos) {
      const f = filaDe(filas, o)
      if (!f) continue
      porClave.set(o.clave, f)
      mapa.set(o.clave, { proporcion: f.proporcion === null || f.proporcion === undefined ? null : Number(f.proporcion) })
    }
  }
  return {
    mapa,
    leer: async (clave: string) => {
      const f = porClave.get(clave)
      return f ? dataUrlDeFila(workspaceId, f) : null
    },
  }
}
