/**
 * QUÉ TARIFAS LE LLEGAN AL CLIENTE, Y EN QUÉ ORDEN (N-17 del QA Trappvel del 2026-10-29, ronda 3).
 *
 * En el viaje 04 la asesora armó la Premium con el Mendihuaca, marcó «Mandarla al cliente» y el
 * cliente recibió dos versiones: la marca no quedó y nada lo dijo antes de enviar. Además esa
 * Premium salía MÁS BARATA que la Recomendada, y el documento la imprime de tercera como la versión
 * «Superior».
 *
 * Aquí, puro, lo que la pantalla dice:
 *  · el aviso del toque en «Mandarla al cliente», con la dirección (antes: «Cambiaste qué tarifas van
 *    en la propuesta», igual para marcar y desmarcar);
 *  · las tarifas con nombre que NO se mandan y no repiten otra que sí (renglón de «Revisa antes de
 *    enviar»);
 *  · el orden de precios: la Premium por debajo de la Recomendada, o la Económica por encima.
 */

import { pesos } from './tarjeta-opcion'
import { claveTarifa, esRecomendada } from './tarifas'

export interface TarifaAlCliente {
  nombre: string | null
  precio: number
  /** Va en la propuesta (la marca guardada; la Recomendada siempre). */
  vaEnPropuesta: boolean
  /** Lo que suma: dos tarifas con la misma firma son la misma. */
  firma: string
}

const esLa = (t: TarifaAlCliente, nombre: 'Económica' | 'Premium') => claveTarifa(t.nombre) === claveTarifa(nombre)

/** El aviso tras tocar «Mandarla al cliente». */
export function textoDeMandar(nombre: string | null, va: boolean): string {
  const quien = nombre?.trim() ? `La ${nombre.trim()}` : 'La tarifa'
  return va ? `${quien} se manda al cliente.` : `${quien} ya no se manda al cliente.`
}

/** Las tarifas con nombre que el cliente no va a ver, sin contar las que repiten una que sí va. */
export function tarifasSinMandar(tarifas: readonly TarifaAlCliente[]): string[] {
  const firmasQueVan = new Set(tarifas.filter(t => t.vaEnPropuesta || esRecomendada(t.nombre)).map(t => t.firma))
  return tarifas
    .filter(t => !esRecomendada(t.nombre) && !t.vaEnPropuesta && (esLa(t, 'Económica') || esLa(t, 'Premium')))
    .filter(t => !firmasQueVan.has(t.firma))
    .map(t => t.nombre as string)
}

/** «La Premium no se manda al cliente…»: el renglón de Revisar para cada una. */
export function textoSinMandar(nombre: string): string {
  return `La ${nombre} no se manda al cliente: en Tarifas está sin marcar «Mandarla al cliente».`
}

/**
 * El orden de precios entre las que van: la Premium debe costar más que la Recomendada y la
 * Económica menos. Devuelve un aviso por tarifa fuera de orden (vacío = en orden).
 */
export function avisosDeOrdenDeTarifas(tarifas: readonly TarifaAlCliente[]): { nombre: string; texto: string }[] {
  const rec = tarifas.find(t => esRecomendada(t.nombre))
  if (!rec || !(rec.precio > 0)) return []
  const avisos: { nombre: string; texto: string }[] = []
  for (const t of tarifas) {
    if (t === rec || !t.vaEnPropuesta || !(t.precio > 0) || t.firma === rec.firma) continue
    if (esLa(t, 'Premium') && t.precio < rec.precio) {
      avisos.push({
        nombre: t.nombre as string,
        texto: `La ${t.nombre} sale más barata que la Recomendada (${pesos(t.precio)} frente a ${pesos(rec.precio)}) y el documento la presenta como la versión Superior. Cambia su vuelo u hotel, o no la mandes.`,
      })
    }
    if (esLa(t, 'Económica') && t.precio > rec.precio) {
      avisos.push({
        nombre: t.nombre as string,
        texto: `La ${t.nombre} sale más cara que la Recomendada (${pesos(t.precio)} frente a ${pesos(rec.precio)}). Cambia su vuelo u hotel, o no la mandes.`,
      })
    }
  }
  return avisos
}
