/**
 * Un catálogo de fotos de MUESTRA para el COT-2026-0026 (`propuesta-europa.ts`): lo que
 * `catalogoParaLaPropuesta` devolvería con las fotos del prototipo ya en `fotos_catalogo`.
 * Las de ciudad y planes son las de Wikimedia Commons del ensayo del PR 0, con su autor y
 * licencia reales.
 *
 * Hoteles (decisión de Mauricio del 2026-10-14): la asesora subió la foto de SOLO 3; los demás
 * van con el degradado. Le Meurice trae una de Commons a propósito: la plantilla no la imprime.
 */
import path from 'node:path'
import type { EntradaModeloPropuesta } from '@/lib/cotizaciones/propuesta/modelo-documento'
import type { CatalogoPropuesta, FotoDeCatalogo } from '@/lib/pdf/html/propuesta-html'
import { claveDeFoto, nombreLlano } from '@/lib/fotos/clave'
import { creditoDeCatalogo } from '@/lib/fotos/wikimedia'

const FOTOS = path.join(process.cwd(), 'src/lib/pdf/chromium/ensayo/fotos')

const foto = (archivo: string, nombre: string, autor: string, licencia: string): FotoDeCatalogo => ({
  src: path.join(FOTOS, archivo),
  origen: 'wikimedia',
  credito: creditoDeCatalogo({ nombre, autor, licencia }),
})

/** Una foto que subió la asesora: sin crédito. */
const propia = (archivo: string): FotoDeCatalogo => ({ src: path.join(FOTOS, archivo), origen: 'asesora', credito: null })

/** Barcelona y Ámsterdam no están en el banco de ciudades: salen del catálogo. */
export const CIUDADES_CATALOGO: Record<string, FotoDeCatalogo> = {
  [claveDeFoto('ciudad', 'Barcelona')]: foto('c_bcn.jpg', 'Casa Batlló', 'Txllxt TxllxT', 'CC BY-SA 4.0'),
  [claveDeFoto('ciudad', 'Ámsterdam')]: foto('c_ams.jpg', 'Nieuwe Keizersgracht', 'Fons Heijnsbroek', 'CC0'),
}

export const OPCIONALES_CATALOGO: Record<string, FotoDeCatalogo> = {
  [nombreLlano('Palacio Real de Madrid')]: foto('o_palacio.jpg', 'Palacio Real de Madrid', 'Jose Luis Filpo Cabana', 'CC BY 3.0'),
  [nombreLlano('Tour del Bernabéu')]: foto('o_bernabeu.jpg', 'Estadio Santiago Bernabéu', 'Zoser', 'CC BY 4.0'),
  [nombreLlano('Park Güell con guía')]: foto('o_guell.jpg', 'Park Güell', 'Isiwal', 'CC BY-SA 3.0'),
  [nombreLlano('Aquàrium de Barcelona')]: foto('o_aqua.jpg', 'Aquàrium de Barcelona', 'Paul Hermans', 'CC BY-SA 3.0'),
  [nombreLlano('Disneyland Paris')]: foto('o_disney.jpg', 'Disneyland Paris', 'Kapsuglan', 'CC BY-SA 4.0'),
  [nombreLlano('El Louvre en familia')]: foto('o_louvre.jpg', 'Cour Napoléon, Louvre', 'Benh LIEU SONG', 'CC BY 2.5'),
  [nombreLlano('Crucero con cena por el Sena')]: foto('o_sena.jpg', 'Bateaux Mouches', 'Joe deSousa', 'CC BY 2.0'),
  [nombreLlano('Molinos de Zaanse Schans')]: foto('o_zaanse.jpg', 'Zaanse Schans', 'DimiTalen', 'CC0'),
}

/** Los 3 hoteles con foto subida por la asesora. */
export const HOTELES_SUBIDOS: Record<string, FotoDeCatalogo> = {
  [claveDeFoto('hotel', 'Catalonia Puerta del Sol', 'Madrid')]: propia('catalonia.jpg'),
  [claveDeFoto('hotel', 'H10 Metropolitan', 'Barcelona')]: propia('h10.jpg'),
  [claveDeFoto('hotel', 'Pullman Paris Tour Eiffel', 'París')]: propia('pullman.jpg'),
}

/** Una foto de Commons de un hotel que quedó en el catálogo: NO debe salir en la propuesta. */
export const CREDITO_HOTEL_DE_COMMONS = creditoDeCatalogo({ nombre: 'Le Meurice', autor: 'Autor de Ejemplo', licencia: 'CC BY-SA 4.0' })!
const HOTEL_DE_COMMONS: Record<string, FotoDeCatalogo> = {
  [claveDeFoto('hotel', 'Le Meurice', 'París')]: { ...foto('meurice.jpg', 'Le Meurice', 'Autor de Ejemplo', 'CC BY-SA 4.0') },
}

export const CATALOGO_EUROPA: CatalogoPropuesta = {
  ciudad: (ciudad) => CIUDADES_CATALOGO[claveDeFoto('ciudad', ciudad)] ?? null,
  hotel: (hotel, ciudad) => {
    const k = claveDeFoto('hotel', hotel, ciudad)
    return HOTELES_SUBIDOS[k] ?? HOTEL_DE_COMMONS[k] ?? null
  },
  actividad: (nombre) => OPCIONALES_CATALOGO[nombreLlano(nombre)] ?? null,
}

/** La entrada sin la foto de la opción en ningún hotel: el catálogo decide cuál lleva foto. */
export function sinFotosDeHotel<T extends EntradaModeloPropuesta>(e: T): T {
  const v = e.props.viaje
  if (!v) return e
  return { ...e, props: { ...e.props, viaje: { ...v, hoteles: v.hoteles.map((h) => ({ ...h, foto: undefined })) } } }
}
