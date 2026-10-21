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
import { leerTarifaPax } from './tarifa-pasajero'

export interface PedidoDeLinea {
  tipo: 'hotel' | 'actividad'
  nombre: string
  ciudad: string | null
  /**
   * El nombre lo ESCRIBIÓ una persona («✎ Escríbelo a mano»), no salió de un pantallazo (brief del
   * 2026-10-20, punto 2). Un servicio escrito a mano no es un proveedor: con él no se crea ninguna
   * ficha al pintar la tarjeta, ni se toma por nombre una ficha para el panel de tarifas o el IVA.
   * Las fotos de un perfil que ya existe se siguen viendo.
   */
  aMano: boolean
}

/** ¿El servicio de la línea lo escribió una persona? Casilla 1, o su primera habitación. */
export function lineaEscritaAMano(item: Pick<ItemConLectura, 'tarifa_pax'>): boolean {
  const t = leerTarifaPax(item.tarifa_pax)
  // Lo mismo que `esManual` (ingreso-manual.ts), sin arrastrar el formulario a este módulo puro.
  return (t.casillas?.grupo_completo ?? t.habitaciones?.[0]?.lectura ?? null)?.origen === 'manual'
}

export function pedidoDeLinea(item: ItemConLectura): PedidoDeLinea | null {
  const slug = ranuraDeGrupo(item.grupo)?.slug
  if (slug === 'hotel_detalle') {
    const [hotel] = hotelesDeItems([item])
    const nombre = hotel ? hotel.hotel ?? hotel.linea : null
    return hotel && nombre ? { tipo: 'hotel', nombre, ciudad: hotel.ciudad ?? null, aMano: lineaEscritaAMano(item) } : null
  }
  if (slug === 'actividad_detalle') {
    const nombre = nombreVisibleDeLinea(item)
    return nombre ? { tipo: 'actividad', nombre, ciudad: ciudadDeActividad(item), aMano: lineaEscritaAMano(item) } : null
  }
  return null
}
