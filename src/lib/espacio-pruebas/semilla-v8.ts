/**
 * La semilla de V8 (criterios de Vera, §5: «Una habitación de Posada Enilda mal leída: 2 adultos
 * que eran 2 adultos y 1 niño. Se corrige desde el ⋯ de la habitación; la cobertura y el precio
 * cambian en el acto»).
 *
 * Hasta la re-verificación D, la semilla traía la Posada como la deja el caso fijo de C0: UNA
 * lectura sin ocupación («1 habitación sin ocupación», vio Vera), así que el caso de §1 no se
 * podía reproducir. Aquí la Posada son TRES dobles (R8, una habitación por pantallazo), cada una
 * con su ocupación, como las dejaría la bandeja:
 *
 *  · Doble 1 · 2 adultos · $409.699
 *  · Doble 2 · 2 adultos y 1 infante · $409.699
 *  · Doble 3 · leída «2 adultos» (eran 2 adultos y 1 niño) · $409.700
 *
 * Suman $1.229.098, el mismo costo de la Posada en C0: los precios grabados del caso fijo siguen
 * valiendo y la cotización se abre con el total de siempre. La cobertura dice «falta 1 niño»
 * hasta que se corrige la Doble 3.
 *
 * El costo confirmado se arma con las MISMAS funciones que usa «Confirmar» (`resolverHabitaciones`,
 * `firmaDeHabitaciones`): una confirmación escrita a mano que no casara con las habitaciones haría
 * que ONE pidiera volver a confirmarla, y eso no es lo que V8 prueba.
 */

import type { Fila } from './almacen'
import { repartirHabitaciones, resolverHabitaciones, tarifaConHabitaciones } from '@/lib/cotizaciones/habitaciones'
import { firmaDeEstadia } from '@/lib/cotizaciones/estadia'
import {
  firmaDeHabitaciones,
  type Composicion,
  type Habitacion,
  type LecturaCasilla,
  type TarifaConfirmada,
  type TarifaPax,
} from '@/lib/cotizaciones/tarifa-pasajero'

const HOTEL = 'Posada Enilda'
const CIUDAD = 'Isla de Providencia'
const ENTRADA = '2026-11-23'
const SALIDA = '2026-11-25'
const LEIDA_EN = '2026-10-12T13:55:00.000Z'
const CONFIRMADA_EN = '2026-10-12T14:00:00.000Z'

/** Una habitación de la Posada tal como la deja la lectura de su pantallazo. */
function lecturaDeDoble(ocupacionTexto: string, c: Composicion, total: number): LecturaCasilla {
  const campos: [string, string][] = [
    ['Hotel', HOTEL], ['Ciudad', CIUDAD], ['Habitación', 'Doble'], ['Régimen', 'Alojamiento y desayuno'],
    ['Check-in', ENTRADA], ['Check-out', SALIDA], ['Noches', '2'], ['Ocupación', ocupacionTexto],
    ['Adultos en la captura', String(c.adultos)], ['Niños en la captura', String(c.ninos)], ['Infantes en la captura', String(c.infantes)],
    ['Moneda', 'COP'], ['Precio', String(total)],
  ]
  return {
    moneda: 'COP',
    total,
    aPagarAgencia: null,
    costoAgenciaOrigen: null,
    porTipo: [],
    ocupacion: { adultos: c.adultos, ninos: c.ninos, infantes: c.infantes, total: c.adultos + c.ninos + c.infantes },
    ocupacionDelItem: false,
    identidad: { hotel: HOTEL, tipo_habitacion: 'Doble', regimen: 'Alojamiento y desayuno', check_in: ENTRADA, check_out: SALIDA },
    notasCliente: [],
    alertas: [],
    campos: campos.map(([label, valor]) => ({ label, valor })),
    nombre: `${HOTEL} · ${CIUDAD}`,
    descripcion: `Habitación: Doble · Régimen: Alojamiento y desayuno · ${ENTRADA} a ${SALIDA} · Ocupación: ${ocupacionTexto}`,
    leidaEn: LEIDA_EN,
  }
}

/** Las tres dobles de la Posada; la tercera, mal leída. */
export function doblesDeLaPosada(): Habitacion[] {
  return [
    { id: 'hab-posada-doble-1', lectura: lecturaDeDoble('2 adultos', { adultos: 2, ninos: 0, infantes: 0 }, 409_699) },
    { id: 'hab-posada-doble-2', lectura: lecturaDeDoble('2 adultos, 1 infante', { adultos: 2, ninos: 0, infantes: 1 }, 409_699) },
    // V8 · la mal leída: el pantallazo decía 2 adultos y 1 niño.
    { id: 'hab-posada-doble-3', lectura: lecturaDeDoble('2 adultos', { adultos: 2, ninos: 0, infantes: 0 }, 409_700) },
  ]
}

/**
 * La tarifa de la Posada para V8: las tres dobles y su costo confirmado. `grupo` = quiénes viajan
 * (6 adultos, 1 niño y 1 infante en el caso fijo).
 */
export function tarifaPosadaV8(actual: TarifaPax, grupo: Composicion): TarifaPax {
  const habitaciones = doblesDeLaPosada()
  const { confirmada: _vieja, ...sinConfirmar } = actual
  void _vieja
  const base: TarifaPax = { ...sinConfirmar, casillas: {} }
  const tarifa = tarifaConHabitaciones(base, habitaciones, grupo)
  const estado = resolverHabitaciones(tarifa, grupo, { moneda: 'COP' })
  if (estado.estado !== 'resuelta') throw new Error(`Semilla V8: la Posada no quedó costeada (${estado.mensaje})`)
  const reparto = repartirHabitaciones(habitaciones, grupo, tarifa.correcciones)
  const firmaEstadia = firmaDeEstadia(habitaciones, tarifa.correcciones)
  const confirmada: TarifaConfirmada = {
    composicion: reparto.cubiertos,
    costos: estado.costos.map(c => ({ tipo: c.tipo, cantidad: c.cantidad, unitarioCOP: c.unitario, totalCOP: c.total })),
    costoTotalCOP: estado.costoTotal,
    moneda: 'COP',
    tasa: null,
    confirmadaEn: CONFIRMADA_EN,
    firmaHabitaciones: firmaDeHabitaciones(habitaciones),
    ...(estado.porHabitacion && estado.costos.length === 0
      ? { porHabitacion: estado.porHabitacion.map(h => ({ numero: h.numero, ocupacion: h.ocupacion, totalCOP: h.total })) }
      : {}),
    ...(firmaEstadia ? { firmaEstadia } : {}),
  }
  return { ...tarifa, confirmada }
}

/** Aplica la semilla de V8 sobre la fila de la Posada ya remapeada. El costo no cambia. */
export function sembrarPosadaV8(item: Fila, grupo: Composicion): void {
  const antes = (item.tarifa_pax ?? {}) as TarifaPax
  const costoAntes = antes.confirmada?.costoTotalCOP ?? null
  const tarifa = tarifaPosadaV8(antes, grupo)
  if (costoAntes !== null && Math.abs(costoAntes - (tarifa.confirmada?.costoTotalCOP ?? 0)) > 0.5) {
    throw new Error(`Semilla V8: las tres dobles cuestan ${tarifa.confirmada?.costoTotalCOP} y la Posada de C0 ${costoAntes}`)
  }
  item.tarifa_pax = tarifa as unknown as Fila
}
