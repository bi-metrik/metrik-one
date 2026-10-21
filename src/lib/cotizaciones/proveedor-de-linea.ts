/**
 * Qué hotel o tour nombra una línea de la cotización (su «pedido» a la biblioteca de proveedores).
 * PURO.
 *
 * Es lo MISMO que arma la tarjeta para buscar sus fotos y su ficha (`tarjeta-opcion.tsx`): el
 * hotel leído del pantallazo con su ciudad, o el nombre visible de la actividad con la suya. Lo usa
 * también el servidor para saber qué proveedor tiene cada línea al aplicar la casilla «Calcular con
 * IVA» (2026-10-19). Si cada lado lo calculara por su cuenta, la tarjeta podría mostrar una ficha y
 * el IVA aplicarse según otra.
 */
import { ciudadDeActividad, hotelesDeItems, type ItemConLectura } from './detalle-viaje'
import { nombreVisibleDeLinea } from './nombre-visible'
import { ranuraDeGrupo } from './ranuras-pantallazo'

export interface PedidoDeLinea {
  tipo: 'hotel' | 'actividad'
  nombre: string
  ciudad: string | null
}

export function pedidoDeLinea(item: ItemConLectura): PedidoDeLinea | null {
  const slug = ranuraDeGrupo(item.grupo)?.slug
  if (slug === 'hotel_detalle') {
    const [hotel] = hotelesDeItems([item])
    const nombre = hotel ? hotel.hotel ?? hotel.linea : null
    return hotel && nombre ? { tipo: 'hotel', nombre, ciudad: hotel.ciudad ?? null } : null
  }
  if (slug === 'actividad_detalle') {
    const nombre = nombreVisibleDeLinea(item)
    return nombre ? { tipo: 'actividad', nombre, ciudad: ciudadDeActividad(item) } : null
  }
  return null
}
