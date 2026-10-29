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
  CATEGORIAS_INCLUYE,
  ETIQUETA_INCLUYE,
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
  const conNino = p.distribucion.adultoConNino ?? 0
  if (conNino > 0) habitaciones.push(`${conNino} ${conNino === 1 ? 'habitación' : 'habitaciones'} de 1 adulto + 1 niño`)
  const partes: string[] = []
  if (habitaciones.length > 0) {
    partes.push(habitaciones.length === 1 ? habitaciones[0] : `${habitaciones.slice(0, -1).join(', ')} y ${habitaciones[habitaciones.length - 1]}`)
  }
  // Los niños que duermen con su adulto ya están dichos en su habitación.
  const otrosNinos = Math.max(0, p.distribucion.ninos - conNino)
  if (otrosNinos > 0) partes.push(conNino > 0 ? plural(otrosNinos, 'niño más', 'niños más') : plural(otrosNinos, 'niño', 'niños'))
  if ((p.distribucion.infantes ?? 0) > 0) partes.push(plural(p.distribucion.infantes as number, 'infante', 'infantes'))
  return partes.length > 0 ? partes.join(' · ') : null
}

/** Las fechas del viaje (la Solicitud del negocio), ISO. */
export interface FechasDeRespaldo {
  inicio: string | null
  fin: string | null
}

/**
 * Las fechas del hotel del paquete: las del vuelo o la salida manual; si el paquete no trae ninguna,
 * las del viaje del negocio (D6 de Mauricio, 2026-10-29). Sin esto, un paquete sin vuelo ni salida
 * manual daba un itinerario de un solo día.
 */
export function fechasDelHotelDelPaquete(p: PaqueteBloqueo, respaldo?: FechasDeRespaldo | null): { entrada: string | null; salida: string | null } {
  const f = fechasDelPaquete(p)
  // Con vuelo o salida manual, lo de siempre.
  if (f.origen !== null) return { entrada: f.salida, salida: f.regreso }
  const entrada = respaldo?.inicio ?? null
  const salida = entrada && p.hotel.noches ? sumarDiasIso(entrada, p.hotel.noches) : respaldo?.fin ?? null
  return { entrada, salida }
}

function sumarDiasIso(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10)
}

/** El hotel de cada paquete de bloqueo, como la ficha de «Hospedaje». */
export function hotelesDePaquetes(items: readonly ItemConLectura[], respaldo?: FechasDeRespaldo | null): HotelPDF[] {
  const out: HotelPDF[] = []
  for (const item of items) {
    const p = paqueteDe(item)
    if (!p || !p.hotel.hotel) continue
    const fechas = fechasDelHotelDelPaquete(p, respaldo)
    const incluye = incluidoEnPalabras(p.incluye).filter(x => x !== 'Tiquete aéreo')
    const noIncluido = CATEGORIAS_INCLUYE.filter(c => c !== 'tiquete_aereo' && p.incluye.casillas[c] === false).map(c => ETIQUETA_INCLUYE[c]).filter(x => !incluye.includes(x))
    const nino = p.hotel.nino
    out.push({
      linea: (item.nombre ?? '').trim(),
      hotel: p.hotel.hotel,
      ciudad: p.hotel.zona,
      habitacion: p.hotel.habitacion,
      regimen: p.hotel.planAlimentacion,
      checkIn: fechaCorta(fechas.entrada),
      checkOut: fechaCorta(fechas.salida),
      noches: p.hotel.noches,
      ocupacion: acomodacionDelPaquete(p),
      cancelacion: null,
      estrellas: null,
      localizador: null,
      adicionales: item.adicionales ?? [],
      ...(incluye.length > 0 ? { incluye: incluye.join(', ') } : {}),
      ...(noIncluido.length > 0 ? { noIncluidoEnCasillas: noIncluido } : {}),
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

/**
 * Lo que los paquetes NO incluyen (V5 del QA del 2026-10-29: «No incluye: tarjeta de turismo,
 * propinas» no llegaba al cliente). Un renglón por paquete que lo diga, para «A tener en cuenta»;
 * con varios paquetes distintos, cada renglón nombra su hotel. Sin repetidos.
 */
export function noIncluyeDePaquetes(items: readonly ItemConLectura[]): string[] {
  const conTexto = items
    .map(paqueteDe)
    .filter((p): p is PaqueteBloqueo => !!p && !!p.incluye.noIncluye)
  const textos = [...new Set(conTexto.map(p => (p.incluye.noIncluye as string).trim()))]
  if (textos.length <= 1) return textos.map(t => `No incluido en el paquete: ${minusculaInicial(t)}`)
  const vistos = new Set<string>()
  const out: string[] = []
  for (const p of conTexto) {
    const r = `No incluido en el paquete${p.hotel.hotel ? ` ${p.hotel.hotel}` : ''}: ${minusculaInicial((p.incluye.noIncluye as string).trim())}`
    if (!vistos.has(r)) { vistos.add(r); out.push(r) }
  }
  return out
}

const minusculaInicial = (t: string) => (t && t !== t.toLocaleUpperCase('es-CO') ? t.charAt(0).toLocaleLowerCase('es-CO') + t.slice(1) : t)
