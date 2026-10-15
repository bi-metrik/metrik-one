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
  cantidadDeTipo,
  composicionDeLectura,
  composicionDeLinea,
  costosAManoComoMapa,
  describirOcupacion,
  leerTarifaPax,
  mismaComposicion,
  monedaDeTarifa,
  preciosQueFaltan,
  type Composicion,
  type TarifaPax,
  type TipoPasajero,
} from './tarifa-pasajero'
import { ranuraDeGrupo } from './ranuras-pantallazo'

const TIPOS: readonly TipoPasajero[] = ['adulto', 'nino', 'infante']
const RANURAS_CON_PRECIO_POR_PASAJERO = new Set(['vuelo_detalle', 'actividad_detalle'])

export interface OpcionSinPrecio {
  id: string
  nombre: string
  tipos: TipoPasajero[]
  /**
   * H1 · un vuelo cuyo pantallazo cubre MENOS adultos que el viaje (el «Valor por adulto» sin
   * cantidad que la lectura toma como 1 adulto): a cuántos cubre. Ausente = cubre a todos.
   */
  adultosCubiertos?: number
  /** Con `adultosCubiertos`: cuántos adultos van en el viaje. */
  adultosDelViaje?: number
}

/**
 * H1 (verificación D de Vera, 2026-10-14) · la composición que decide qué precio falta.
 *
 * La lectura de un pantallazo fija en la línea la ocupación que MUESTRA (`guardarLecturaEnItem`,
 * §2.4): un pantallazo de SATENA con solo «Adulto · 6» deja la línea en 6/0/0 aunque en el viaje
 * vayan 6 adultos, 1 niño y 1 infante. Para un hotel eso es lo correcto (la habitación es para
 * quien muestra). Para un VUELO no: viaja todo el grupo, y lo que el pantallazo no trae es el
 * PRECIO del niño y del infante, no su asiento. Con 6/0/0 la regla del precio que falta no se
 * disparaba, «Completa SATENA: precio del niño» no aparecía y la opción cobraba solo a los 6.
 *
 * Aquí la línea se mira como si ese pantallazo se hubiera escrito a mano con el niño y el infante
 * vacíos (`sinPrecio`, C5): cubre a los tipos del viaje, y los que no trae quedan SIN PRECIO.
 *
 * Solo cuando la composición de la línea es la que dio ese mismo pantallazo: una que no coincide
 * la escribió una persona, y manda. Solo vuelos: una actividad para menos pasajeros (el buceo de 2
 * adultos) es una decisión de quien cotiza. Los adultos no se tocan: un pantallazo con menos
 * adultos que el viaje no se completa con un precio, lo dice `adultosCortos`.
 *
 * Puro y sin efecto con la pantalla de siempre: lo usan solo la forma por pasos y sus acciones.
 */
export function conPasajerosDelViaje(tarifa: TarifaPax, composicionViaje: Composicion | null, ranuraSlug: string | null | undefined): TarifaPax {
  if (!composicionViaje || ranuraSlug !== 'vuelo_detalle') return tarifa
  const propia = tarifa.composicion ?? null
  const l1 = tarifa.casillas?.grupo_completo
  if (!propia || !l1) return tarifa
  const leida = composicionDeLectura(l1)
  if (!leida || !mismaComposicion(leida, propia)) return tarifa
  const tipos = (['nino', 'infante'] as const).filter(t => cantidadDeTipo(propia, t) === 0 && cantidadDeTipo(composicionViaje, t) > 0)
  if (tipos.length === 0) return tarifa
  const composicion: Composicion = {
    adultos: propia.adultos,
    ninos: tipos.includes('nino') ? composicionViaje.ninos : propia.ninos,
    infantes: tipos.includes('infante') ? composicionViaje.infantes : propia.infantes,
  }
  const sinPrecio = [...new Set([...(l1.sinPrecio ?? []), ...tipos])]
  const grupoCompleto = {
    ...l1,
    sinPrecio,
    ocupacion: { ...l1.ocupacion, adultos: l1.ocupacion?.adultos ?? propia.adultos, ninos: composicion.ninos, infantes: composicion.infantes },
    paraComposicion: composicion,
  }
  return {
    ...tarifa,
    // Se queda PROPIA, como la dejó el pantallazo: si mañana cambian los pasajeros del viaje, la
    // captura queda vieja igual que antes (`capturasDesactualizadas`), no se rehace sola.
    composicion,
    casillas: { ...(tarifa.casillas ?? {}), grupo_completo: grupoCompleto },
  }
}

/**
 * H1 · un vuelo cuyo pantallazo cubre menos adultos que el viaje: cuántos cubre. `null` = cubre a
 * todos (o no es un vuelo, o la composición la escribió una persona).
 *
 * Es el «Valor por adulto: COP 470.314» sin cantidad: la lectura lo toma como 1 adulto y la opción
 * quedaba en un tiquete para 8 viajeros, con «Todo listo». No se adivina si era un precio c/u o la
 * búsqueda de una persona: impide enviar y lo dice.
 */
export function adultosCortos(
  linea: { grupo: string | null; tarifa_pax: unknown },
  composicionViaje: Composicion | null,
): number | null {
  const ranura = ranuraDeGrupo(linea.grupo)
  if (!composicionViaje || ranura?.slug !== 'vuelo_detalle') return null
  const tarifa = leerTarifaPax(linea.tarifa_pax)
  const propia = tarifa.composicion ?? null
  const l1 = tarifa.casillas?.grupo_completo
  if (!propia || !l1) return null
  const leida = composicionDeLectura(l1)
  if (!leida || !mismaComposicion(leida, propia)) return null
  return propia.adultos < composicionViaje.adultos ? propia.adultos : null
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
  const tarifa = conPasajerosDelViaje(leerTarifaPax(linea.tarifa_pax), composicionViaje, ranura.slug)
  if (!tarifa.casillas?.grupo_completo) return []
  const c = composicionDeLinea(tarifa, composicionViaje)
  if (!c) return []
  // Con el costo ya confirmado por tipo de pasajero, no falta nada: cada tipo que viaja tiene
  // su fila (un pantallazo con desglose, la resta, o lo escrito a mano).
  const confirmados = new Set((tarifa.confirmada?.costos ?? []).map(x => x.tipo))
  if (tarifa.confirmada && TIPOS.every(t => cantidadDeTipo(c, t) === 0 || confirmados.has(t))) return []
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
    .map(l => {
      const linea = { grupo: l.grupo ?? null, tarifa_pax: l.tarifa_pax ?? null }
      const cubiertos = adultosCortos(linea, composicionViaje)
      return {
        id: l.id,
        nombre: (l.nombre ?? '').trim() || 'Una opción',
        tipos: tiposSinPrecio(linea, composicionViaje),
        ...(cubiertos !== null && composicionViaje ? { adultosCubiertos: cubiertos, adultosDelViaje: composicionViaje.adultos } : {}),
      }
    })
    .filter(o => o.tipos.length > 0 || o.adultosCubiertos !== undefined)
}

/** «Falta precio: niño, infante» (la cabecera de la opción y «Lo que suma»). */
export function textoCortoSinPrecio(tipos: readonly TipoPasajero[]): string {
  return `Falta precio: ${tipos.map(t => PALABRA[t]).join(', ')}`
}

/**
 * Lo que le falta a una opción, corto: «Cubre 1 de 6 adultos · Falta precio: niño, infante».
 * `null` = no le falta nada. Lo usan la cabecera de la opción, «Lo que suma» y la barra.
 */
export function textoCortoDeOpcion(
  linea: { grupo: string | null; tarifa_pax: unknown },
  composicionViaje: Composicion | null,
): string | null {
  const partes: string[] = []
  const cubiertos = adultosCortos(linea, composicionViaje)
  if (cubiertos !== null && composicionViaje) partes.push(`Cubre ${cubiertos} de ${composicionViaje.adultos} adultos`)
  const tipos = tiposSinPrecio(linea, composicionViaje)
  if (tipos.length > 0) partes.push(textoCortoSinPrecio(tipos))
  return partes.length > 0 ? partes.join(' · ') : null
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
  // H1 · la que cubre menos adultos que el viaje va primero: con ella el precio de los demás
  // tampoco se sabe, y lo que hay que hacer es otro pantallazo, no completar un menor.
  const corta = opciones.find(o => o.adultosCubiertos !== undefined)
  if (corta) {
    const n = corta.adultosCubiertos as number
    return `${corta.nombre} trae el precio de ${n} ${n === 1 ? 'adulto' : 'adultos'} y en el viaje van ${corta.adultosDelViaje}: ` +
      'pega el pantallazo de la búsqueda con todo el grupo y quita esta opción.'
  }
  const primeras = opciones.slice(0, 2).map(o => `${o.nombre} (${listaDeTipos(o.tipos)})`)
  const mas = opciones.length > 2 ? ` y ${opciones.length - 2} más` : ''
  return `Falta el precio por pasajero de ${primeras.join(' y ')}${mas}: sin él no se puede decir lo que paga cada uno. Pega el pantallazo con esos pasajeros, escríbelo a mano o confirma que no paga.`
}
