/**
 * Brief del 2026-10-29, punto 3 (COT-2026-0008) · antes del PDF, ONE dice en palabras qué opción
 * cargada no sale en la propuesta, con el arreglo a un toque. Datos inventados con la forma del caso:
 * Económica = el barato, Recomendada = el caro, Premium = el caro otra vez (no se manda) y el del
 * medio en ninguna tarifa.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { listaUnica, opcionesFueraDeLaPropuesta, type EntradaDeLista } from './lista-unica'
import { aplicarPlan, planDeTarifas } from './tarifas-por-pasos'
import { ListaUnicaPorPasos } from '@/app/(app)/negocios/por-pasos/lista-unica-por-pasos'

const H = 'hotel: Hotel en Willemstad'
const linea = (id: string, grupo: string, orden: number) => ({ id, grupo, orden, es_ajuste: false, dia_relativo: null, entra_al_precio: true })
const items = [linea('v-vuelo', 'vuelo: Vuelo Bogotá–Willemstad', 1), linea('h-caro', H, 2), linea('h-medio', H, 3), linea('h-barato', H, 4)]
const tarifa = (id: string, nombre: string, orden: number, va: boolean, hotel: string) => ({ id, nombre, orden, vaEnPropuesta: va, seleccion: [hotel] })
const COMO_QUEDO = [
  tarifa('t-rec', 'Recomendada', 2, true, 'h-caro'),
  tarifa('t-eco', 'Económica', 1, true, 'h-barato'),
  tarifa('t-prem', 'Premium', 3, false, 'h-caro'),
]

const VACIA: EntradaDeLista = {
  sinPrecio: [], capturas: null, tarifas: [], salida: null, pantallazosPorAceptar: 0, texto: 'ok',
  noVan: [], faltaDia: null, margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null,
}

describe('opcionesFueraDeLaPropuesta', () => {
  it('el hotel en ninguna tarifa, con el arreglo en la Premium que repetía a la Recomendada', () => {
    expect(opcionesFueraDeLaPropuesta(items, COMO_QUEDO)).toEqual([
      { itemId: 'h-medio', grupo: H, arreglo: { itinerarioId: 't-prem', tarifa: 'Premium' } },
    ])
  })

  it('una opción en una tarifa que NO se manda también queda fuera', () => {
    const tarifas = [tarifa('t-rec', 'Recomendada', 2, true, 'h-caro'), tarifa('t-eco', 'Económica', 1, true, 'h-barato'), tarifa('t-prem', 'Premium', 3, false, 'h-medio')]
    expect(opcionesFueraDeLaPropuesta(items, tarifas).map(o => [o.itemId, o.arreglo])).toEqual([['h-medio', null]])
  })

  it('con cada hotel en una tarifa que se manda, nada', () => {
    const tarifas = [tarifa('t-rec', 'Recomendada', 2, true, 'h-caro'), tarifa('t-eco', 'Económica', 1, true, 'h-barato'), tarifa('t-prem', 'Premium', 3, true, 'h-medio')]
    expect(opcionesFueraDeLaPropuesta(items, tarifas)).toEqual([])
  })

  it('sin tarifas no hay nada que avisar', () => {
    expect(opcionesFueraDeLaPropuesta(items, [])).toEqual([])
  })
})

describe('el aviso en «Revisar y enviar»', () => {
  const fuera = opcionesFueraDeLaPropuesta(items, COMO_QUEDO).map(o => ({ ...o, nombre: 'Hotel Ficticio Medio · Willemstad' }))

  it('en ámbar, en palabras, sin bloquear el envío', () => {
    const l = listaUnica({ ...VACIA, fueraDeLaPropuesta: fuera })
    expect(l.impide).toEqual([])
    expect(l.revisar).toEqual([{
      clave: 'fuera:h-medio',
      texto: 'Hotel Ficticio Medio · Willemstad no va en ninguna tarifa: no saldrá en la propuesta.',
      ir: { a: 'poner-en-tarifa', itinerarioId: 't-prem', tarifa: 'Premium', grupo: H, itemId: 'h-medio' },
    }])
  })

  it('el botón dice dónde lo pone', () => {
    const html = renderToStaticMarkup(React.createElement(ListaUnicaPorPasos, { lista: listaUnica({ ...VACIA, fueraDeLaPropuesta: fuera }), onIr: () => {} }))
    expect(html).toContain('Ponerlo en la Premium')
    expect(html).toContain('no saldrá en la propuesta')
  })

  it('un toque basta: tras la elección (la misma de Tarifas), la Premium se manda y no queda nada fuera', () => {
    const conCosto = items.map(i => ({ ...i, costo: { 'h-caro': 5_832_000, 'h-medio': 5_382_000, 'h-barato': 3_738_000 }[i.id] ?? 3_500_000 }))
    const antes = { items: conCosto, tarifas: COMO_QUEDO.map(t => ({ ...t, seleccion: [...t.seleccion] })) }
    // Lo que escribe `elegirOpcionEnTarifa`: en la Premium, el hotel del medio en lugar del caro.
    const despues = { items: conCosto, tarifas: antes.tarifas.map(t => (t.id === 't-prem' ? { ...t, seleccion: ['h-medio'] } : t)) }
    const plan = planDeTarifas({ antes, despues, costoDe: id => conCosto.find(i => i.id === id)?.costo ?? null })
    const final = aplicarPlan(despues.tarifas, plan, () => 'nueva')
    expect(final.find(t => t.id === 't-prem')).toMatchObject({ vaEnPropuesta: true, seleccion: ['h-medio'] })
    expect(opcionesFueraDeLaPropuesta(items, final)).toEqual([])
  })

  it('sin tarifa que repita, el renglón lleva a Tarifas', () => {
    const l = listaUnica({ ...VACIA, fueraDeLaPropuesta: [{ itemId: 'h-x', grupo: H, arreglo: null, nombre: 'Hotel X' }] })
    expect(l.revisar[0].ir).toEqual({ a: 'tarifas' })
  })
})
