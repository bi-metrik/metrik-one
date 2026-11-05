/**
 * SAN ANDRÉS en bloqueo (Trappvel, 2026-11-03): 3 adultos, 4 noches, operador ATN (Tu Reserva). Datos
 * sintéticos con las cifras reales de los pantallazos: el vuelo AV 9376 BOG→ADZ del 23-dic y AV 9803
 * ADZ→BOG del 27-dic, y tres hoteles con su tabla de precios por persona.
 */
import { hotelVacio, type HotelBloqueo, type IncluyeBloqueo, type VueloBloqueo } from '../../bloqueo-paquete'

export const VUELO_AV: VueloBloqueo = {
  tramos: [
    { aerolinea: 'AV', numeroVuelo: '9376', origen: 'BOG', destino: 'ADZ', fecha: '2026-12-23', horaSalida: '10:05', horaLlegada: '12:15', fechaLlegada: '2026-12-23', escalas: 0 },
    { aerolinea: 'AV', numeroVuelo: '9803', origen: 'ADZ', destino: 'BOG', fecha: '2026-12-27', horaSalida: '17:15', horaLlegada: '19:25', fechaLlegada: '2026-12-27', escalas: 0 },
  ],
}

/** Otro vuelo (otra salida del mismo bloqueo): abre un paquete aparte. */
export const VUELO_OTRO: VueloBloqueo = {
  tramos: [
    { aerolinea: 'AV', numeroVuelo: '9370', origen: 'BOG', destino: 'ADZ', fecha: '2026-12-26', horaSalida: '06:00', horaLlegada: '08:10', fechaLlegada: '2026-12-26', escalas: 0 },
    { aerolinea: 'AV', numeroVuelo: '9805', origen: 'ADZ', destino: 'BOG', fecha: '2026-12-30', horaSalida: '18:00', horaLlegada: '20:10', fechaLlegada: '2026-12-30', escalas: 0 },
  ],
}

type Fila = [acomodacion: 'sencilla' | 'doble' | 'triple' | 'cuadruple', precio: number]
type Chd = [edadMin: number, edadMax: number, precio: number]

/** Un hotel como lo deja la lectura: la tabla «Precios por persona» y los CHD por rango de edad. */
export function hotelAtn(nombre: string, zona: string, noches: number, plan: string, temporada: string, precios: Fila[], chd: Chd[]): HotelBloqueo {
  const ninos = chd.map(([edadMin, edadMax, precio]) => ({ precio, edadMin, edadMax }))
  return {
    ...hotelVacio(),
    hotel: nombre,
    zona,
    noches,
    habitacion: 'Estandar -Standar',
    planAlimentacion: plan,
    temporada,
    precios: precios.map(([acomodacion, precioPorPersona]) => ({ acomodacion, precioPorPersona })),
    nino: ninos[0] ?? null,
    ...(ninos.length >= 2 ? { ninosPorEdad: ninos } : {}),
  }
}

const PAM = '(P.A.M.) Desayuno y Cena'

// Las tablas de los pantallazos 7, 8 y 9 (ATN 1988-P).
export const KORAY = hotelAtn('Koray Hotel', 'Zona LA ROCOSA - KORAY', 4, PAM, 'Alta | Promo',
  [['triple', 2441205], ['cuadruple', 2441205], ['doble', 2489985], ['sencilla', 3507059]], [[2, 3, 1124132], [4, 11, 2246083]])
export const ISLA_BONITA = hotelAtn('Hotel Isla Bonita', 'Zona SAN LUIS', 4, PAM, 'Alta | Promo',
  [['triple', 2294863], ['cuadruple', 2294863], ['doble', 2343644], ['sencilla', 3214376]], [[2, 3, 1124132], [4, 11, 2099741]])
export const SOL_CARIBE = hotelAtn('Hotel Sol Caribe San Andres', 'Zona URBANA-CENTRO', 4, '(FULL) Desayuno, Almuerzo y Cena', 'Alta | Promo',
  [['doble', 3110717], ['triple', 3110717], ['sencilla', 3479010]], [[2, 2, 1100961], [3, 11, 2105839]])

export const INCLUYE: IncluyeBloqueo = {
  casillas: { tiquete_aereo: true, alimentacion: true, planes_tours: null, traslados: true, seguro_medico: true },
  sinIdentificar: [],
  texto: null,
}

export const TRES_ADULTOS = { adultos: 3, ninos: 0, infantes: 0 }
