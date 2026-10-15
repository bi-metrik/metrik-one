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
import { motivoSinRecomendada, type TarifaParaRegla } from './tarifas'

export type DestinoDeIr =
  | { a: 'opcion'; itemId: string }
  | { a: 'tarifas' }
  | { a: 'bandeja' }
  | { a: 'texto' }
  | { a: 'viaje' }

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
  /** P12 · las opciones que van al cliente sin un precio por pasajero. */
  sinPrecio: readonly OpcionSinPrecio[]
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
   * Las reservas de varias habitaciones en un solo pantallazo cuya ocupación no cuadra con los
   * viajeros (`avisoDeReservaQueNoCuadra`). Avisa, no impide (decisión del 2026-10-14).
   */
  reservasQueNoCuadran?: readonly { itemId: string; texto: string }[]
}

/** «Nada impide enviar y no hay nada por revisar.» */
export const LISTA_VACIA = 'Nada impide enviar y no hay nada por revisar.'

export function listaUnica(e: EntradaDeLista): ListaUnica {
  const impide: RenglonDeLista[] = []
  // El orden del servidor: `enviarPorPasos` (P12), y luego `enviarCotizacion` (capturas,
  // Recomendada, falta un costo, margen).
  const p12 = motivoSinPrecioPorPasajero(e.sinPrecio)
  if (p12) impide.push({ clave: 'precio-por-pasajero', texto: p12, ir: e.sinPrecio[0] ? { a: 'opcion', itemId: e.sinPrecio[0].id } : null })
  if (e.capturas) impide.push({ clave: 'capturas', texto: e.capturas.motivo, ir: e.capturas.itemId ? { a: 'opcion', itemId: e.capturas.itemId } : null })
  const rec = motivoSinRecomendada(e.tarifas)
  if (rec) impide.push({ clave: 'recomendada', texto: rec, ir: { a: 'tarifas' } })
  const nota = notaDeMargen(e.salida)
  const motivoMargen = 'motivoBoton' in nota ? nota.motivoBoton : null
  if (motivoMargen) {
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
  if (e.texto === 'viejo') revisar.push({ clave: 'texto', texto: 'El texto se escribió con otros servicios: revisa el párrafo marcado.', ir: { a: 'texto' } })
  for (const s of e.noVan) revisar.push({ clave: `no-va:${s.itemId}`, texto: `${s.nombre} no va: el cliente no lo verá ni lo paga.`, ir: { a: 'opcion', itemId: s.itemId } })
  if (e.faltaDia) revisar.push({ clave: 'dia', texto: e.faltaDia, ir: null })
  if (e.margenBajoAviso) revisar.push({ clave: 'aviso-margen', texto: e.margenBajoAviso, ir: { a: 'tarifas' } })
  if (e.recargo) revisar.push({ clave: 'recargo', texto: e.recargo, ir: null })
  if (e.viaje) revisar.push({ clave: 'viaje', texto: e.viaje, ir: { a: 'viaje' } })
  if (e.ivaSinCalcular) revisar.push({ clave: 'iva', texto: e.ivaSinCalcular, ir: null })
  for (const r of e.reservasQueNoCuadran ?? []) revisar.push({ clave: `reserva:${r.itemId}`, texto: r.texto, ir: { a: 'opcion', itemId: r.itemId } })
  return { impide, revisar }
}
