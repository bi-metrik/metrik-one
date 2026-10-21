/**
 * Una sola verdad para la foto de un hotel en la propuesta (Mauricio, 2026-10-16: «dónde quedó lo
 * de la biblioteca, debería ser aquí», sobre el recuadro de la tarjeta).
 *
 * Desde ese día la foto que la asesora pone en la tarjeta del hotel se guarda en la biblioteca del
 * espacio (`fotos_catalogo`, llave `hotel|ciudad`), no en la opción. La propuesta lee primero la
 * biblioteca; la foto «propia de la opción» (`tarifa_pax.fotoHotel`, de antes) solo vale cuando la
 * biblioteca no tiene una imprimible para ese hotel. Así la tarjeta, el panel «Fotos de la
 * propuesta», `/fotos` y el documento muestran la misma foto.
 *
 * Puro: quien llama pone cómo leer cada archivo (servidor) y si el documento es el motor html
 * (que trae la de la biblioteca él mismo, con sus extras, desde `catalogoParaLaPropuesta`).
 */
import type { HotelPDF } from '@/lib/cotizaciones/detalle-viaje'
import { claveDeFoto } from './clave'

/** La llave de la biblioteca para un hotel del documento (la misma de `objetivosDeItems`). */
export function claveDeHotel(h: Pick<HotelPDF, 'hotel' | 'linea' | 'ciudad'>): string {
  return claveDeFoto('hotel', h.hotel ?? h.linea, h.ciudad)
}

/** ¿De dónde sale la foto de este hotel? La biblioteca manda; la de la opción es el respaldo. */
export function fuenteDeFotoDeHotel(enBiblioteca: boolean, fotoRef: string | null | undefined): 'biblioteca' | 'opcion' | null {
  if (enBiblioteca) return 'biblioteca'
  return fotoRef ? 'opcion' : null
}

/**
 * Pone la foto a cada hotel del documento:
 *  · con foto imprimible en la biblioteca: con el motor html no se toca (la pone el catálogo, con
 *    sus extras); con @react-pdf, la de la biblioteca;
 *  · sin ella, la de la opción (`fotoRef`), como hasta hoy;
 *  · si el archivo no se pudo leer, el hotel queda como venía (sale el degradado o la ciudad).
 */
export async function fotosDeHotelesDelDocumento<H extends HotelPDF>(
  hoteles: H[],
  a: {
    /** Las llaves de hotel con foto imprimible en la biblioteca, con su proporción y su crédito (Commons). */
    biblioteca: Map<string, { proporcion: number | null; credito?: string | null }>
    motorHtml: boolean
    leerDeBiblioteca: (clave: string) => Promise<string | null>
    leerDeOpcion: (ref: string) => Promise<string | null>
  },
): Promise<H[]> {
  return Promise.all(
    hoteles.map(async (h) => {
      const clave = claveDeHotel(h)
      const deBiblioteca = clave ? a.biblioteca.get(clave) : undefined
      const fuente = fuenteDeFotoDeHotel(!!deBiblioteca, h.fotoRef)
      if (fuente === 'biblioteca') {
        if (a.motorHtml) return h
        const url = await a.leerDeBiblioteca(clave)
        if (url) return { ...h, foto: { url, proporcion: deBiblioteca?.proporcion ?? null, credito: deBiblioteca?.credito ?? null } }
        // La biblioteca falló al leer: el respaldo de la opción, si lo hay.
        if (!h.fotoRef) return h
      }
      if (fuente === null || !h.fotoRef) return h
      const url = await a.leerDeOpcion(h.fotoRef)
      return url ? { ...h, foto: { url, proporcion: h.fotoProporcion ?? null } } : h
    }),
  )
}
