/**
 * LA LISTA ÚNICA de «Revisar y enviar» (cotización por pasos, C6; decisión 7 de Noor; D8 de Vera).
 *
 * Dos grupos, arriba del documento:
 *  · **Impide enviar** (rojo): lo mismo que el servidor rechaza al enviar, en el MISMO orden, y
 *    nada más. Sale de las mismas funciones: el precio por pasajero que falta (P12, la forma por
 *    pasos), las capturas de otros pasajeros (`motivoParaNoEnviar`), la Recomendada
 *    (`motivoSinRecomendada`) y la salida (`notaDeMargen`: falta un costo, o bajo el mínimo sin
 *    autorizar).
 *  · **Revisa antes de enviar** (ámbar): no bloquea.
 *
 * Cada renglón trae su «Ir»: la tarjeta de la opción, el paso de Tarifas, la bandeja o el texto.
 *
 * Puro: lo usan la pantalla y la prueba que la compara con el servidor.
 */

import { notaDeMargen, type SalidaParaNota } from './nota-margen'
import { motivoSinPrecioPorPasajero, type OpcionSinPrecio } from './precio-que-falta'
import { esRecomendada, motivoSinRecomendada, type TarifaParaRegla } from './tarifas'
import { ranurasConAlternativas, type ItemConGrupo } from './itinerarios'
import { motivoPaquetesIncompletos, type PaqueteIncompleto } from './bloqueo-incompleto'
import { motivoPublicasSinComision, type PublicaSinComision } from './comision-publica'
import { textoSinMandar } from './tarifas-al-cliente'

export type DestinoDeIr =
  /** `campo`: además de abrir la opción, pone el foco en esa casilla (QA del #1342: la comisión). */
  | { a: 'opcion'; itemId: string; campo?: 'comision' }
  | { a: 'tarifas' }
  | { a: 'bandeja' }
  | { a: 'texto' }
  | { a: 'viaje' }
  /** El arreglo a un toque: poner la opción que quedó fuera en la tarifa que repetía otra. */
  | { a: 'poner-en-tarifa'; itinerarioId: string; tarifa: string; grupo: string; itemId: string }

export interface RenglonDeLista {
  /** Estable, para la prueba y para el DOM. */
  clave: string
  texto: string
  ir: DestinoDeIr | null
}

export interface ListaUnica {
  impide: RenglonDeLista[]
  revisar: RenglonDeLista[]
}

export interface EntradaDeLista {
  /**
   * El cliente no ha autorizado sus datos (reunión del 2026-10-22, `autorizacion-datos/envio.ts`):
   * la cotización se arma, pero no se envía. Es lo primero que rechaza el servidor.
   */
  autorizacionDatos?: string | null
  /** P12 · las opciones que van al cliente sin un precio por pasajero. */
  sinPrecio: readonly OpcionSinPrecio[]
  /**
   * Viaje en bloqueo (QA del 2026-10-29): los paquetes que se ofrecen y están incompletos (costo 0,
   * infante sin costo, niño fuera del rango CHD, acomodación sin precio). Ausente = ninguno.
   */
  paquetes?: readonly PaqueteIncompleto[]
  /** D3 (2026-10-29): las opciones Públicas que van al cliente sin su comisión. Ausente = ninguna. */
  publicasSinComision?: readonly PublicaSinComision[]
  /** El texto de `motivoParaNoEnviar` (capturas de otros pasajeros) y la primera línea que lo causa. */
  capturas: { motivo: string; itemId: string | null } | null
  /** Las tarifas, para la regla de la Recomendada. */
  tarifas: readonly TarifaParaRegla[]
  /** La salida (margen mínimo y costos), como la ve el editor. */
  salida: (SalidaParaNota & { faltaCostoLineas?: { id: string }[] | null }) | null
  // ── Lo que no bloquea ──
  pantallazosPorAceptar: number
  /** El texto para el cliente: sin leer, viejo, o bien. */
  texto: 'nada' | 'sinrevisar' | 'viejo' | 'ok'
  /** «{Servicio} no va: el cliente no lo verá ni lo paga.» */
  noVan: readonly { itemId: string; nombre: string }[]
  /** Actividad incluida sin día. */
  faltaDia: string | null
  /** Margen bajo el aviso (no bloquea). */
  margenBajoAviso: string | null
  /** Recargo de vuelo internacional sin poner. */
  recargo: string | null
  /** Faltan fechas o pasajeros en el negocio. */
  viaje: string | null
  /** IVA sin calcular: ámbar, no impide enviar (Vera 10). */
  ivaSinCalcular: string | null
  /**
   * Con el texto viejo, cuántos párrafos nombran un servicio que salió (`parrafosViejos`). `0` = el
   * texto es de otros servicios pero ningún párrafo los nombra; ausente = no se sabe.
   */
  parrafosMarcados?: number | null
  /**
   * Las reservas de varias habitaciones en un solo pantallazo cuya ocupación no cuadra con los
   * viajeros (`avisoDeReservaQueNoCuadra`). Avisa, no impide (decisión del 2026-10-14).
   */
  reservasQueNoCuadran?: readonly { itemId: string; texto: string }[]
  /**
   * Brief del 2026-10-29, punto 3 · las opciones de vuelo u hotel que no van en ninguna tarifa que
   * se manda (`opcionesFueraDeLaPropuesta`), con su nombre. Ausente = ninguna.
   */
  fueraDeLaPropuesta?: readonly (OpcionFuera & { nombre: string })[]
  /**
   * N-17 (QA del 2026-10-29, ronda 3) · las tarifas con nombre que no se mandan al cliente
   * (`tarifasSinMandar`), y las que van fuera del orden de precios (`avisosDeOrdenDeTarifas`).
   * Ausente = ninguna.
   */
  tarifasSinMandar?: readonly string[]
  ordenDeTarifas?: readonly { nombre: string; texto: string }[]
}

/** Una opción de vuelo u hotel que no sale en la propuesta, y dónde ponerla de un toque. */
export interface OpcionFuera {
  itemId: string
  grupo: string
  /** La tarifa que repite la opción de otra en ese servicio: ahí cabe sin quitar nada. `null` = ninguna. */
  arreglo: { itinerarioId: string; tarifa: string } | null
  /**
   * La opción SÍ está en una tarifa, pero esa tarifa no se manda al cliente (QA del #1342: un paquete
   * de bloqueo sacado de la propuesta decía «no va en ninguna tarifa»). Ausente = en ninguna.
   */
  enUnaQueNoVa?: boolean
}

/**
 * Brief del 2026-10-29, punto 3 (COT-2026-0008) · las opciones de vuelo u hotel cargadas que no van
 * en NINGUNA tarifa que se manda: el cliente no las verá. El Sunscape estaba en «En ninguna tarifa»
 * y Alejandra no lo entendió; el aviso lo dice antes del PDF, en palabras, con el arreglo.
 *
 * El arreglo: la tarifa (no la Recomendada) que en ese servicio repite la opción de otra. Primero
 * las que no se mandan (quedaron idénticas a otra), luego las demás. Sin ninguna que repita, se
 * avisa sin arreglo (hay que ir a Tarifas).
 */
export function opcionesFueraDeLaPropuesta(
  items: ItemConGrupo[],
  tarifas: readonly (TarifaParaRegla & { seleccion: readonly string[] })[],
): OpcionFuera[] {
  if (tarifas.length === 0) return []
  const salida: OpcionFuera[] = []
  const usadas = new Set<string>()
  for (const r of ranurasConAlternativas(items).filter(x => x.combinable)) {
    const eleccion = (t: (typeof tarifas)[number]) => r.candidatos.find(id => t.seleccion.includes(id)) ?? null
    const enLaPropuesta = new Set(tarifas.filter(t => t.vaEnPropuesta).map(eleccion).filter((id): id is string => id !== null))
    const fuera = r.candidatos.filter(id => !enLaPropuesta.has(id))
    if (fuera.length === 0) continue
    const repiten = tarifas
      .filter(t => !esRecomendada(t.nombre))
      .filter(t => {
        const mia = eleccion(t)
        return mia !== null && tarifas.some(o => o.id !== t.id && eleccion(o) === mia)
      })
      .sort((a, b) => Number(a.vaEnPropuesta) - Number(b.vaEnPropuesta) || b.orden - a.orden)
    for (const itemId of fuera) {
      const t = repiten.find(x => !usadas.has(x.id)) ?? null
      if (t) usadas.add(t.id)
      const enUnaQueNoVa = tarifas.some(x => !x.vaEnPropuesta && eleccion(x) === itemId)
      salida.push({ itemId, grupo: r.grupo, arreglo: t ? { itinerarioId: t.id, tarifa: t.nombre ?? 'tarifa' } : null, ...(enUnaQueNoVa ? { enUnaQueNoVa } : {}) })
    }
  }
  return salida
}

/** «Nada impide enviar y no hay nada por revisar.» */
export const LISTA_VACIA = 'Nada impide enviar y no hay nada por revisar.'

export function listaUnica(e: EntradaDeLista): ListaUnica {
  const impide: RenglonDeLista[] = []
  // El orden del servidor: `enviarPorPasos` (autorización de datos, P12), y luego
  // `enviarCotizacion` (capturas, Recomendada, falta un costo, margen).
  if (e.autorizacionDatos) impide.push({ clave: 'autorizacion-datos', texto: e.autorizacionDatos, ir: null })
  const p12 = motivoSinPrecioPorPasajero(e.sinPrecio)
  if (p12) impide.push({ clave: 'precio-por-pasajero', texto: p12, ir: e.sinPrecio[0] ? { a: 'opcion', itemId: e.sinPrecio[0].id } : null })
  // `enviarPorPasos` lo revisa justo después de P12, antes del margen de `enviarCotizacion`.
  const paquete = motivoPaquetesIncompletos(e.paquetes ?? [])
  if (paquete) impide.push({ clave: 'paquete-incompleto', texto: paquete, ir: { a: 'opcion', itemId: e.paquetes![0].itemId } })
  // D3: justo después del paquete, como `enviarPorPasos`.
  const comision = motivoPublicasSinComision(e.publicasSinComision ?? [])
  if (comision) impide.push({ clave: 'comision-publica', texto: comision, ir: { a: 'opcion', itemId: e.publicasSinComision![0].itemId, campo: 'comision' } })
  if (e.capturas) impide.push({ clave: 'capturas', texto: e.capturas.motivo, ir: e.capturas.itemId ? { a: 'opcion', itemId: e.capturas.itemId } : null })
  const rec = motivoSinRecomendada(e.tarifas)
  if (rec) impide.push({ clave: 'recomendada', texto: rec, ir: { a: 'tarifas' } })
  const nota = notaDeMargen(e.salida)
  const motivoMargen = 'motivoBoton' in nota ? nota.motivoBoton : null
  // Con un paquete incompleto el margen no se puede medir (su costo no está en la cuenta): decir
  // «bajo el mínimo» señalaría la causa equivocada. Lo que impide es el paquete.
  // Con una Pública sin comisión, igual: el margen no se puede medir y la causa es la comisión.
  if (motivoMargen && !((paquete || comision) && nota.tipo !== 'incompleta')) {
    const primera = e.salida?.faltaCostoLineas?.[0]?.id ?? null
    impide.push({
      clave: nota.tipo === 'incompleta' ? 'falta-costo' : 'margen',
      texto: motivoMargen,
      ir: nota.tipo === 'incompleta' && primera ? { a: 'opcion', itemId: primera } : { a: 'tarifas' },
    })
  }

  const revisar: RenglonDeLista[] = []
  if (e.pantallazosPorAceptar > 0) {
    const n = e.pantallazosPorAceptar
    revisar.push({ clave: 'bandeja', texto: `${n} ${n === 1 ? 'pantallazo sin aceptar: no está' : 'pantallazos sin aceptar: no están'} en el precio.`, ir: { a: 'bandeja' } })
  }
  if (e.texto === 'sinrevisar') revisar.push({ clave: 'texto', texto: 'El texto para el cliente lo escribió ONE y nadie lo ha leído.', ir: { a: 'texto' } })
  if (e.texto === 'viejo') {
    // Re-verificación D · sin un párrafo que nombre lo que salió, no hay «párrafo marcado» que revisar.
    const texto = e.parrafosMarcados === 0
      ? 'El texto se escribió con otros servicios: léelo o actualízalo con ONE.'
      : 'El texto se escribió con otros servicios: revisa el párrafo marcado.'
    revisar.push({ clave: 'texto', texto, ir: { a: 'texto' } })
  }
  for (const s of e.noVan) revisar.push({ clave: `no-va:${s.itemId}`, texto: `${s.nombre} no va: el cliente no lo verá ni lo paga.`, ir: { a: 'opcion', itemId: s.itemId } })
  if (e.faltaDia) revisar.push({ clave: 'dia', texto: e.faltaDia, ir: null })
  if (e.margenBajoAviso) revisar.push({ clave: 'aviso-margen', texto: e.margenBajoAviso, ir: { a: 'tarifas' } })
  if (e.recargo) revisar.push({ clave: 'recargo', texto: e.recargo, ir: null })
  if (e.viaje) revisar.push({ clave: 'viaje', texto: e.viaje, ir: { a: 'viaje' } })
  if (e.ivaSinCalcular) revisar.push({ clave: 'iva', texto: e.ivaSinCalcular, ir: null })
  for (const r of e.reservasQueNoCuadran ?? []) revisar.push({ clave: `reserva:${r.itemId}`, texto: r.texto, ir: { a: 'opcion', itemId: r.itemId } })
  for (const o of e.fueraDeLaPropuesta ?? []) {
    revisar.push({
      clave: `fuera:${o.itemId}`,
      texto: o.enUnaQueNoVa
        ? `${o.nombre} va en una opción que no se manda al cliente: no saldrá en la propuesta.`
        : `${o.nombre} no va en ninguna tarifa: no saldrá en la propuesta.`,
      ir: o.arreglo
        ? { a: 'poner-en-tarifa', itinerarioId: o.arreglo.itinerarioId, tarifa: o.arreglo.tarifa, grupo: o.grupo, itemId: o.itemId }
        : { a: 'tarifas' },
    })
  }
  for (const n of e.tarifasSinMandar ?? []) revisar.push({ clave: `sin-mandar:${n}`, texto: textoSinMandar(n), ir: { a: 'tarifas' } })
  for (const o of e.ordenDeTarifas ?? []) revisar.push({ clave: `orden:${o.nombre}`, texto: o.texto, ir: { a: 'tarifas' } })
  return { impide, revisar }
}
