/**
 * El PAQUETE DE BLOQUEO en el documento del cliente (QA del 2026-10-29).
 *
 * La propuesta (html con el formato de Edgar, y el PDF de @react-pdf de Trappvel) arma «Hospedaje» y
 * «Vuelos» con `hotelesDeItems` y `vuelosDeItems`, que leen las casillas del pantallazo de una ranura
 * de hotel o de vuelo. El paquete no tiene casillas: su hotel, su acomodación, su aerolínea y sus
 * tramos viven en `tarifa_pax.bloqueo`. Sin esto la propuesta de un bloqueo salía sin hotel ni vuelos.
 *
 * Va aparte de `hotelesDeItems`/`vuelosDeItems` a propósito: esas dos las usan también el margen
 * (colchón de vuelo, `reglas-margen.ts`) y el recargo internacional (`recargo-linea.ts`). Si el
 * paquete apareciera ahí como vuelo, le cambiaría el precio; aquí solo se DESCRIBE.
 *
 * Puro: sin red y sin base.
 */

import {
  ETIQUETA_ACOMODACION,
  ACOMODACIONES,
  fechasDelPaquete,
  incluidoEnPalabras,
  leerPaqueteBloqueo,
  type PaqueteBloqueo,
  type TramoBloqueo,
} from './bloqueo-paquete'
import { fechaCorta, horaCorta, type HotelPDF, type ItemConLectura, type VueloPDF } from './detalle-viaje'
import { ranuraDeGrupo } from './ranuras-pantallazo'
import { leerTarifaPax } from './tarifa-pasajero'

function paqueteDe(item: ItemConLectura): PaqueteBloqueo | null {
  if (ranuraDeGrupo(item.grupo)?.slug !== 'paquete_detalle') return null
  return leerPaqueteBloqueo(leerTarifaPax(item.tarifa_pax).bloqueo)
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

/** «2 dobles y 1 sencilla · 1 niño»: cómo se reparte el grupo en el hotel. `null` sin reparto. */
export function acomodacionDelPaquete(p: PaqueteBloqueo): string | null {
  const habitaciones = ACOMODACIONES
    .filter(a => (p.distribucion.habitaciones[a] ?? 0) > 0)
    .map(a => {
      const n = p.distribucion.habitaciones[a] as number
      const nombre = ETIQUETA_ACOMODACION[a].toLowerCase()
      return `${n} ${n === 1 ? nombre : `${nombre}s`}`
    })
  const partes: string[] = []
  if (habitaciones.length > 0) {
    partes.push(habitaciones.length === 1 ? habitaciones[0] : `${habitaciones.slice(0, -1).join(', ')} y ${habitaciones[habitaciones.length - 1]}`)
  }
  if (p.distribucion.ninos > 0) partes.push(plural(p.distribucion.ninos, 'niño', 'niños'))
  if ((p.distribucion.infantes ?? 0) > 0) partes.push(plural(p.distribucion.infantes as number, 'infante', 'infantes'))
  return partes.length > 0 ? partes.join(' · ') : null
}

/** El hotel de cada paquete de bloqueo, como la ficha de «Hospedaje». */
export function hotelesDePaquetes(items: readonly ItemConLectura[]): HotelPDF[] {
  const out: HotelPDF[] = []
  for (const item of items) {
    const p = paqueteDe(item)
    if (!p || !p.hotel.hotel) continue
    const fechas = fechasDelPaquete(p)
    const incluye = incluidoEnPalabras(p.incluye).filter(x => x !== 'Tiquete aéreo')
    const nino = p.hotel.nino
    out.push({
      linea: (item.nombre ?? '').trim(),
      hotel: p.hotel.hotel,
      ciudad: p.hotel.zona,
      habitacion: p.hotel.habitacion,
      regimen: p.hotel.planAlimentacion,
      checkIn: fechaCorta(fechas.salida),
      checkOut: fechaCorta(fechas.regreso),
      noches: p.hotel.noches,
      ocupacion: acomodacionDelPaquete(p),
      cancelacion: null,
      estrellas: null,
      localizador: null,
      adicionales: item.adicionales ?? [],
      ...(incluye.length > 0 ? { incluye: incluye.join(', ') } : {}),
      ...(nino && p.distribucion.ninos > 0 && nino.edadMin !== null && nino.edadMax !== null ? { edadNino: { desde: nino.edadMin, hasta: nino.edadMax } } : {}),
    })
  }
  return out
}

const mismaCiudad = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

function vueloDeTramos(linea: string, ida: TramoBloqueo, regreso: TramoBloqueo | null): VueloPDF {
  return {
    linea,
    aerolinea: ida.aerolinea ?? regreso?.aerolinea ?? null,
    origen: ida.origen,
    destino: ida.destino,
    fechaSalida: fechaCorta(ida.fecha),
    fechaRegreso: fechaCorta(regreso?.fecha ?? null),
    horaSalida: horaCorta(ida.horaSalida),
    horaLlegada: horaCorta(ida.horaLlegada),
    horaSalidaRegreso: horaCorta(regreso?.horaSalida ?? null),
    horaLlegadaRegreso: horaCorta(regreso?.horaLlegada ?? null),
    escalaIda: null,
    escalaRegreso: null,
    escalas: ida.escalas,
    tarifa: null,
    equipaje: null,
    adicionales: [],
    numeros: { ida: ida.numeroVuelo, regreso: regreso?.numeroVuelo ?? null, sinAsignar: null },
  }
}

/**
 * Los vuelos de cada paquete. Ida y regreso de la misma ruta al revés van en UN vuelo (como la tabla
 * de siempre); cualquier otro arreglo de tramos va tramo por tramo, sin inventar un regreso.
 */
export function vuelosDePaquetes(items: readonly ItemConLectura[]): VueloPDF[] {
  const out: VueloPDF[] = []
  for (const item of items) {
    const p = paqueteDe(item)
    const tramos = p?.vuelo?.tramos ?? []
    if (tramos.length === 0) continue
    const linea = (item.nombre ?? '').trim()
    const [a, b] = tramos
    if (tramos.length === 2 && mismaCiudad(a.origen, b.destino) && mismaCiudad(a.destino, b.origen)) {
      out.push({ ...vueloDeTramos(linea, a, b), adicionales: item.adicionales ?? [] })
      continue
    }
    for (const t of tramos) out.push({ ...vueloDeTramos(linea, t, null), adicionales: item.adicionales ?? [] })
  }
  return out
}
