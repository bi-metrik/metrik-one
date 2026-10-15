/**
 * Un catálogo de fotos de MUESTRA para el COT-2026-0026 (`propuesta-europa.ts`): lo que
 * `catalogoParaLaPropuesta` devolvería con las fotos del prototipo ya en `fotos_catalogo`.
 * Son las fotos de Wikimedia Commons del ensayo del PR 0, con su autor y licencia reales.
 */
import path from 'node:path'
import type { CatalogoPropuesta, FotoDeCatalogo } from '@/lib/pdf/html/propuesta-html'
import { claveDeFoto, nombreLlano } from '@/lib/fotos/clave'
import { creditoDeCatalogo } from '@/lib/fotos/wikimedia'

const FOTOS = path.join(process.cwd(), 'src/lib/pdf/chromium/ensayo/fotos')

const foto = (archivo: string, nombre: string, autor: string, licencia: string): FotoDeCatalogo => ({
  src: path.join(FOTOS, archivo),
  credito: creditoDeCatalogo({ nombre, autor, licencia }),
})

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

export const CATALOGO_EUROPA: CatalogoPropuesta = {
  ciudad: (ciudad) => CIUDADES_CATALOGO[claveDeFoto('ciudad', ciudad)] ?? null,
  hotel: () => null,
  actividad: (nombre) => OPCIONALES_CATALOGO[nombreLlano(nombre)] ?? null,
}
