/**
 * EL PRECIO POR PASAJERO QUE FALTA (regla del 2026-10-12, aprobada por Mauricio; P12 de Vera).
 *
 * Una opción de vuelo o de actividad cuyo pantallazo trae solo el precio del adulto: falta el
 * del niño o el del infante. Sin él no se puede imprimir lo que paga cada uno, así que en la
 * forma por pasos IMPIDE ENVIAR. Se cierra de tres maneras: con un pantallazo nuevo (la casilla
 * de la tarjeta, o la bandeja, que lo reconoce como «Completa {opción}»), escribiéndolo a mano, o
 * con «No paga en este proveedor» (`escribirPrecioQueFalta`).
 *
 * Puro: lo usan el servidor (enviar) y la pantalla (la tarjeta, «Lo que suma», la lista).
 */

import {
  casillasConEstadia,
} from './estadia'
import {
  composicionDeLinea,
  costosAManoComoMapa,
  describirOcupacion,
  leerTarifaPax,
  monedaDeTarifa,
  preciosQueFaltan,
  type Composicion,
  type TipoPasajero,
} from './tarifa-pasajero'
import { ranuraDeGrupo } from './ranuras-pantallazo'

const RANURAS_CON_PRECIO_POR_PASAJERO = new Set(['vuelo_detalle', 'actividad_detalle'])

export interface OpcionSinPrecio {
  id: string
  nombre: string
  tipos: TipoPasajero[]
}

const PALABRA: Record<TipoPasajero, string> = { adulto: 'adulto', nino: 'niño', infante: 'infante' }

/** «niño e infante», «niño», «infante». */
export function listaDeTipos(tipos: readonly TipoPasajero[]): string {
  const p = tipos.map(t => PALABRA[t])
  if (p.length <= 1) return p.join('')
  const ultimo = p[p.length - 1]
  return `${p.slice(0, -1).join(', ')}${ultimo.startsWith('i') ? ' e ' : ' y '}${ultimo}`
}

/** Lo que le falta a UNA opción. Vacío = no le falta nada (o no es vuelo ni actividad). */
export function tiposSinPrecio(
  linea: { grupo: string | null; tarifa_pax: unknown },
  composicionViaje: Composicion | null,
): TipoPasajero[] {
  const ranura = ranuraDeGrupo(linea.grupo)
  if (!ranura || !RANURAS_CON_PRECIO_POR_PASAJERO.has(ranura.slug)) return []
  const tarifa = leerTarifaPax(linea.tarifa_pax)
  if (!tarifa.casillas?.grupo_completo) return []
  const c = composicionDeLinea(tarifa, composicionViaje)
  if (!c) return []
  return preciosQueFaltan(c, casillasConEstadia(tarifa.casillas ?? {}, tarifa.correcciones), ranura.slug, {
    moneda: monedaDeTarifa(tarifa).moneda,
    aMano: costosAManoComoMapa(tarifa),
  })
}

/** Las opciones que van al cliente y les falta un precio por pasajero. */
export function opcionesSinPrecio(
  lineas: readonly { id: string; nombre: string | null; grupo?: string | null; tarifa_pax?: unknown }[],
  idsQueSalen: ReadonlySet<string>,
  composicionViaje: Composicion | null,
): OpcionSinPrecio[] {
  return lineas
    .filter(l => idsQueSalen.has(l.id))
    .map(l => ({ id: l.id, nombre: (l.nombre ?? '').trim() || 'Una opción', tipos: tiposSinPrecio({ grupo: l.grupo ?? null, tarifa_pax: l.tarifa_pax ?? null }, composicionViaje) }))
    .filter(o => o.tipos.length > 0)
}

/** «Falta precio: niño, infante» (la cabecera de la opción y «Lo que suma»). */
export function textoCortoSinPrecio(tipos: readonly TipoPasajero[]): string {
  return `Falta precio: ${tipos.map(t => PALABRA[t]).join(', ')}`
}

/**
 * El aviso largo de la tarjeta (copy de Noor): qué falta, con qué ocupación buscar otra vez y
 * que hasta tenerlo no se envía.
 */
export function textoLargoSinPrecio(nombre: string, tipos: readonly TipoPasajero[], busqueda: Composicion | null): string {
  const conQuien = busqueda ? ` Busca otra vez la misma tarifa con ${describirOcupacion(busqueda, 'y')} y pégalo aquí o en la bandeja de arriba: ONE saca el precio que falta.` : ''
  return `${nombre} trae solo el precio del adulto: falta el de ${listaDeTipos(tipos)}.${conQuien} Hasta tenerlo, no se puede enviar.`
}

/** El motivo con que el servidor rechaza «Enviar al cliente». `null` = no falta nada. */
export function motivoSinPrecioPorPasajero(opciones: readonly OpcionSinPrecio[]): string | null {
  if (opciones.length === 0) return null
  const primeras = opciones.slice(0, 2).map(o => `${o.nombre} (${listaDeTipos(o.tipos)})`)
  const mas = opciones.length > 2 ? ` y ${opciones.length - 2} más` : ''
  return `Falta el precio por pasajero de ${primeras.join(' y ')}${mas}: sin él no se puede decir lo que paga cada uno. Pega el pantallazo con esos pasajeros, escríbelo a mano o confirma que no paga.`
}
