/**
 * Los traslados, trenes y actividades que el modelo de la propuesta necesita (`servicios` de
 * `modeloDePropuesta`). El pendiente del PR 1: las props de @react-pdf no los traen, así que la
 * sección «Trenes y traslados» salía vacía y el día a día no los ponía.
 *
 * Sale de la MISMA lectura que el resto del documento (`serviciosDeItems`), línea por línea,
 * con dos cosas más:
 * - el día: si alguien le asignó un día a la línea (`dia_relativo`), manda sobre la fecha
 *   leída del pantallazo, como en la pantalla por pasos (`por-pasos-vista.ts`);
 * - las tarifas a las que pertenece la línea, con varias tarifas en la propuesta (los mismos
 *   índices de `itinerarios` que marcan vuelos y hoteles).
 *
 * Puro.
 */
import { fechaCorta, serviciosDeItems, type ItemConLectura } from '@/lib/cotizaciones/detalle-viaje'
import { esFechaCivil, sumarDiasCivil } from '@/lib/viaje/plan-pagos'
import type { ServicioDelDocumento } from './modelo-documento'

export interface ItemDeServicio extends ItemConLectura {
  /** Día del viaje asignado (1 = el de salida). */
  dia_relativo?: number | null
  /** Índices de tarifa a los que pertenece. Vacío o ausente = todas. */
  tarifas?: number[]
}

export function serviciosDelDocumento(items: readonly ItemDeServicio[], inicio: string | null): ServicioDelDocumento[] {
  const salida: ServicioDelDocumento[] = []
  const inicioIso = inicio && esFechaCivil(inicio.slice(0, 10)) ? inicio.slice(0, 10) : null
  for (const item of items) {
    const dia = typeof item.dia_relativo === 'number' && item.dia_relativo >= 1 ? item.dia_relativo : null
    const fechaDelDia = dia !== null && inicioIso ? fechaCorta(sumarDiasCivil(inicioIso, dia - 1)) : null
    for (const s of serviciosDeItems([item])) {
      salida.push({
        ...s,
        fecha: fechaDelDia ?? s.fecha,
        hora: null,
        ...(item.tarifas && item.tarifas.length > 0 ? { tarifas: [...item.tarifas] } : {}),
      })
    }
  }
  return salida
}
