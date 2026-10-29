/**
 * PÚBLICA SIN COMISIÓN frena «Enviar» (decisión D3 de Mauricio, 2026-10-29, Trappvel).
 *
 * En una tarifa Pública el cliente paga el precio público y la ganancia de la agencia es su
 * comisión. Esa comisión la escribe la asesora a mano, en % o en pesos (`tarifa-publica.ts`), y es
 * OBLIGATORIA: sin ella no se sabe lo que paga la agencia, el margen general (D2) no se puede medir y
 * la cotización no se puede enviar. El PDF sale como borrador con su propio motivo.
 *
 * Hasta el 2026-10-29, una Pública sin comisión salía de la medida del margen («no entra al margen
 * global») y una cotización solo de Públicas quedaba exenta del mínimo: así salió limpia la
 * COT-2026-0009 con dos Netas a costo.
 *
 * Puro: lo usan `enviarPorPasos` (el control), el PDF (la marca) y la lista única de Revisar.
 */

import { leerTipoTarifa, comisionEscrita, esTarifaPublica } from './tarifa-publica'

export interface LineaParaComision {
  id: string
  nombre?: string | null
  es_ajuste?: boolean | null
  tarifa_pax?: unknown
}

export interface PublicaSinComision {
  itemId: string
  nombre: string
}

const sinMayusculas = (t: string) => (t === t.toLocaleUpperCase('es-CO') && /[A-ZÁÉÍÓÚÑ]/.test(t)
  ? t.toLocaleLowerCase('es-CO').replace(/(^|\s)\p{L}/gu, m => m.toLocaleUpperCase('es-CO'))
  : t)

/** ¿Esta línea es Pública y nadie escribió su comisión? */
export function esPublicaSinComision(l: Pick<LineaParaComision, 'es_ajuste' | 'tarifa_pax'>): boolean {
  if (l.es_ajuste === true || !esTarifaPublica(l.tarifa_pax)) return false
  const raw = (l.tarifa_pax as { tipoTarifa?: unknown } | null)?.tipoTarifa
  return comisionEscrita(leerTipoTarifa(raw)) === null
}

/**
 * Las Públicas sin comisión de lo que va al cliente, en el orden de las líneas.
 *
 * @param idsQueSalen Las líneas que van al cliente (las de las tarifas en la propuesta, o las que
 *   aportan al total). Una Pública que no sale (otra opción, «No va») no frena.
 */
export function publicasSinComisionQueSalen(
  lineas: readonly LineaParaComision[],
  idsQueSalen: ReadonlySet<string>,
): PublicaSinComision[] {
  return lineas
    .filter(l => idsQueSalen.has(l.id) && esPublicaSinComision(l))
    .map(l => ({ itemId: l.id, nombre: sinMayusculas((l.nombre ?? '').trim()) || 'Una opción' }))
}

/** El motivo con que «Enviar» se rechaza. `null` = todas las Públicas que salen tienen su comisión. */
export function motivoPublicasSinComision(lista: readonly PublicaSinComision[]): string | null {
  if (lista.length === 0) return null
  const [primera] = lista
  const mas = lista.length > 1 ? ` y ${lista.length - 1} ${lista.length === 2 ? 'opción Pública más' : 'opciones Públicas más'}` : ''
  return `Falta la comisión de la agencia en «${primera.nombre}»${mas}: es tarifa Pública. Escríbela en % o en pesos para poder enviar.`
}
