/**
 * SANTA MARTA en bloqueo (Trappvel, 2026-11-03): 2 adultos, 3 noches, operador ATN (ATN 2010-R). Datos
 * sintéticos con las cifras reales de los pantallazos 11 (vuelo AV 9764 BOG→SMR del 3-ene y AV 8507
 * SMR→BOG del 6-ene), 12, 13 y 14 (tres hoteles; el 14 trae CHD 02-04 y CHD 5-10).
 */
import type { VueloBloqueo } from '../../bloqueo-paquete'
import { hotelAtn } from './san-andres-1103'

export const VUELO_SMR: VueloBloqueo = {
  tramos: [
    { aerolinea: 'AV', numeroVuelo: '9764', origen: 'BOG', destino: 'SMR', fecha: '2027-01-03', horaSalida: '09:15', horaLlegada: '10:50', fechaLlegada: '2027-01-03', escalas: 0 },
    { aerolinea: 'AV', numeroVuelo: '8507', origen: 'SMR', destino: 'BOG', fecha: '2027-01-06', horaSalida: '19:25', horaLlegada: '20:55', fechaLlegada: '2027-01-06', escalas: 0 },
  ],
}

const PAM = '(P.A.M.) Desayuno y Cena'

export const PARAISO_TAYRONA = hotelAtn('Paraíso Tayrona', 'Zona Rodadero 2026-2027', 3, PAM, 'Alta | Regular',
  [['cuadruple', 1406189], ['triple', 1444164], ['doble', 1520113]], [[2, 7, 1140366]])
export const MEDELLIN_RODADERO = hotelAtn('Hotel Medellin Rodadero', 'Zona Rodadero 2026-2027', 3, PAM, 'Alta | Regular',
  [['cuadruple', 1542898], ['triple', 1588468], ['doble', 1842898]], [[2, 4, 931506]])
export const RODADERO_DORADO = hotelAtn('Hotel Rodadero Dorado', 'Zona Rodadero 2026-2027', 3, PAM, 'Alta | Regular',
  [['triple', 1630240], ['cuadruple', 1630240], ['doble', 1653025], ['sencilla', 1928974]], [[2, 4, 931506], [5, 10, 1425177]])

export const DOS_ADULTOS = { adultos: 2, ninos: 0, infantes: 0 }
