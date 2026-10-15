/**
 * Qué fotos necesita una cotización, de sus líneas: las ciudades donde duermen, cada hotel y cada
 * actividad (las opcionales del final son actividades). Puro.
 *
 * El nombre de la actividad es el que imprime el documento (`nombreVisibleDeLinea`), para que la
 * propuesta la encuentre por su nombre.
 */
import { ciudadDeActividad, hotelesDeItems, ranuraDelItem, type ItemConLectura } from '@/lib/cotizaciones/detalle-viaje'
import { nombreVisibleDeLinea } from '@/lib/cotizaciones/nombre-visible'
import { objetivo, sinRepetir, type ObjetivoFoto } from './clave'

export function objetivosDeItems(items: readonly ItemConLectura[]): ObjetivoFoto[] {
  const hoteles = hotelesDeItems([...items])
  const actividades = items.filter((i) => ranuraDelItem(i)?.slug === 'actividad_detalle')
  return sinRepetir([
    ...hoteles.map((h) => objetivo('ciudad', h.ciudad)),
    ...hoteles.map((h) => objetivo('hotel', h.hotel ?? h.linea, h.ciudad)),
    ...actividades.map((i) => objetivo('actividad', nombreVisibleDeLinea(i), ciudadDeActividad(i))),
  ])
}
