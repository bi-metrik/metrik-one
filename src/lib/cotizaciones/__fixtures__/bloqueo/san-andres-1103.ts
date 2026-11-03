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

function hotel(nombre: string, zona: string, triple: number, cuadruple: number, doble: number, sencilla: number): HotelBloqueo {
  return {
    ...hotelVacio(),
    hotel: nombre,
    zona,
    noches: 4,
    habitacion: 'Estandar',
    planAlimentacion: 'Desayuno y cena',
    temporada: 'Alta',
    precios: [
      { acomodacion: 'triple', precioPorPersona: triple },
      { acomodacion: 'cuadruple', precioPorPersona: cuadruple },
      { acomodacion: 'doble', precioPorPersona: doble },
      { acomodacion: 'sencilla', precioPorPersona: sencilla },
    ],
    nino: { precio: 2246083, edadMin: 4, edadMax: 11 },
  }
}

export const KORAY = hotel('Koray Hotel', 'Zona LA ROCOSA - KORAY', 2441205, 2441205, 2489985, 3507059)
export const ISLA_BONITA = hotel('Hotel Isla Bonita', 'Zona SAN LUIS', 2294863, 2294863, 2400000, 3300000)
export const SOL_CARIBE = hotel('Hotel Sol Caribe San Andres', 'Zona URBANA-CENTRO', 3110717, 3110717, 3200000, 4500000)

export const INCLUYE: IncluyeBloqueo = {
  casillas: { tiquete_aereo: true, alimentacion: true, planes_tours: null, traslados: true, seguro_medico: true },
  sinIdentificar: [],
  texto: null,
}

export const TRES_ADULTOS = { adultos: 3, ninos: 0, infantes: 0 }
