/**
 * Piloto «la IA arma, la persona revisa» (2026-11-03): el borrador de una cotización de paquete de
 * bloqueo que el modelo arma de una sola vez con los pantallazos + el manual de la casa del cliente.
 *
 * Reparto: el modelo LEE (pantallazos) y DECIDE la estructura (qué hotel va en qué versión, qué
 * acomodación, cómo se escribe para el cliente, qué preguntar). El código no reglas de negocio:
 * solo recalcula los totales y valida invariantes (`invariantes.ts`). Lo que el modelo no pueda
 * resolver sale en `dudas`, nunca como supuesto callado.
 */

export const VERSIONES = ['Económica', 'Recomendada', 'Superior'] as const
export type Version = (typeof VERSIONES)[number]

export interface TramoBorrador {
  aerolinea: string
  /** Con el código de la aerolínea delante: `AV9376`. */
  numero: string
  origenIata: string
  origenCiudad: string
  destinoIata: string
  destinoCiudad: string
  /** `YYYY-MM-DD` */
  fecha: string
  /** `HH:MM`, 24 h */
  salida: string
  llegada: string
  escalas: number
}

export interface PrecioAcomodacion {
  acomodacion: string
  personasPorHabitacion: number
  precioPorPersona: number
}

export interface DistribucionHabitacion {
  acomodacion: string
  habitaciones: number
  personasPorHabitacion: number
}

export interface HotelBorrador {
  /** Número del pantallazo (1 = el primero que se pasó). */
  pantallazo: number
  version: Version
  nombreEnPantallazo: string
  nombre: string
  zonaEnPantallazo: string | null
  zona: string | null
  noches: number
  habitacion: string
  regimenEnPantallazo: string | null
  regimen: string
  temporada: string | null
  codigoTarifa: string | null
  /** `YYYY-MM-DD` o null */
  compraAntesDe: string | null
  /** pública (ya trae la comisión), neta o no se sabe */
  tipoTarifa: 'publica' | 'neta' | 'desconocida'
  precios: PrecioAcomodacion[]
  ninos: { rango: string; precio: number }[]
  distribucion: DistribucionHabitacion[]
  ninosAsignados: { rango: string; cantidad: number }[]
  /** Lo que el modelo calculó; el código lo recalcula y compara. */
  totalCalculadoPorElModelo: number
  incluyeIconos: string[]
  incluye: string
  /** [ymin, xmin, ymax, xmax] en 0-1000 sobre el pantallazo: la foto del hotel. */
  cajaFoto: number[] | null
}

export interface Duda {
  campo: string
  pregunta: string
  queSePusoMientras: string
  bloquea: boolean
}

export interface BorradorCotizacion {
  titular: string
  intro: string
  destino: string
  vuelos: TramoBorrador[]
  hoteles: HotelBorrador[]
  incluye: string[]
  noIncluye: string[]
  antesDeViajar: string[]
  dudas: Duda[]
}

/** Esquema OpenAPI (subconjunto de Gemini) de la salida. */
const S = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra })
const str = S('STRING')
const strN = S('STRING', { nullable: true })
const int = S('INTEGER')
const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  S('OBJECT', { properties, required, propertyOrdering: Object.keys(properties) })
const arr = (items: unknown) => S('ARRAY', { items })

export const ESQUEMA_BORRADOR = obj({
  titular: str,
  intro: str,
  destino: str,
  vuelos: arr(obj({
    aerolinea: str, numero: str, origenIata: str, origenCiudad: str, destinoIata: str, destinoCiudad: str,
    fecha: str, salida: str, llegada: str, escalas: int,
  })),
  hoteles: arr(obj({
    pantallazo: int,
    version: S('STRING', { enum: [...VERSIONES] }),
    nombreEnPantallazo: str, nombre: str, zonaEnPantallazo: strN, zona: strN,
    noches: int, habitacion: str, regimenEnPantallazo: strN, regimen: str,
    temporada: strN, codigoTarifa: strN, compraAntesDe: strN,
    tipoTarifa: S('STRING', { enum: ['publica', 'neta', 'desconocida'] }),
    precios: arr(obj({ acomodacion: str, personasPorHabitacion: int, precioPorPersona: int })),
    ninos: arr(obj({ rango: str, precio: int })),
    distribucion: arr(obj({ acomodacion: str, habitaciones: int, personasPorHabitacion: int })),
    ninosAsignados: arr(obj({ rango: str, cantidad: int })),
    totalCalculadoPorElModelo: int,
    incluyeIconos: arr(str),
    incluye: str,
    cajaFoto: S('ARRAY', { items: int, nullable: true }),
  })),
  incluye: arr(str),
  noIncluye: arr(str),
  antesDeViajar: arr(str),
  dudas: arr(obj({ campo: str, pregunta: str, queSePusoMientras: str, bloquea: S('BOOLEAN') })),
})
