import 'server-only'

/**
 * El catálogo de fotos que necesita UNA propuesta (motor `html`): lee las filas de sus ciudades,
 * hoteles y planes opcionales, baja los archivos y devuelve las búsquedas que usa
 * `prepararPropuestaHtml`. Sin filas (o sin la migración) devuelve `null` y el documento sale
 * como antes.
 */
import type { CotizacionPDFProps } from '@/lib/pdf/cotizacion-props'
import type { CatalogoPropuesta, FotoDeCatalogo } from '@/lib/pdf/html/propuesta-html'
import { actividadPorNombre, creditoDeFila, dataUrlDeFila, filaDe, leerCatalogo, type FilaCatalogo } from './catalogo'
import { claveDeFoto, fotoImprimible, objetivo, sinRepetir } from './clave'

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function catalogoParaLaPropuesta(supabase: any, workspaceId: string, props: CotizacionPDFProps): Promise<CatalogoPropuesta | null> {
  const pedido = pedidoDeLaPropuesta(props)
  // Un hotel solo con la foto que subió la asesora: una de Commons no se baja ni se imprime.
  const filas = (await leerCatalogo(supabase, workspaceId, pedido)).filter((f) => fotoImprimible(f.tipo, f.origen))
  if (filas.length === 0) return null
  const leidas = new Map<string, FotoDeCatalogo>()
  await Promise.all(
    filas.map(async (f) => {
      const src = await dataUrlDeFila(workspaceId, f)
      if (src) {
        leidas.set(f.id, {
          src,
          origen: f.origen,
          credito: creditoDeFila(f),
          foco: f.foco_x !== null && f.foco_y !== null ? { x: Number(f.foco_x), y: Number(f.foco_y) } : null,
        })
      }
    }),
  )
  const de = (f: FilaCatalogo | null) => (f ? leidas.get(f.id) ?? null : null)
  return {
    ciudad: (ciudad) => de(filaDe(filas, { tipo: 'ciudad', clave: claveDeFoto('ciudad', ciudad) })),
    hotel: (hotel, ciudad) => de(filaDe(filas, { tipo: 'hotel', clave: claveDeFoto('hotel', hotel, ciudad) })),
    actividad: (nombre) => de(actividadPorNombre(filas, nombre, pedido.claveCiudades)),
  }
}
