/**
 * El presupuesto de Ejecución de una cotización con tarifas cuenta la tarifa que escogió el
 * cliente, no las opciones de las tres. Caso real: COT-2026-0009 de Trappvel (tres hoteles
 * en Cancún y un vuelo), leída por SELECT el 2026-09-24.
 */
import { describe, expect, it } from 'vitest'

import fixture from './__fixtures__/cot-2026-0009-tarifas.fixture.json'
import {
  calcularPresupuestoPorRubro,
  itemsDeLaTarifaAceptada,
  precioDeLaCotizacionAceptada,
  presupuestoDeCosto,
  totalPresupuestado,
  type ItemPresupuesto,
} from './presupuesto-ejecucion'
import type { ItemConGrupo } from '@/lib/cotizaciones/itinerarios'

type Item = ItemPresupuesto & ItemConGrupo
const ITEMS = fixture.items as unknown as Item[]
const seleccionDe = (nombre: string) => fixture.tarifas.find(t => t.nombre === nombre)!.seleccion

const presupuesto = (seleccion: string[] | null) =>
  totalPresupuestado(calcularPresupuestoPorRubro(itemsDeLaTarifaAceptada(ITEMS, seleccion)))

describe('COT-2026-0009: el presupuesto es el de la tarifa escogida', () => {
  it('Económica escogida: ≈ 11,2 M, no los 31,4 M de todas las opciones', () => {
    expect(presupuesto(seleccionDe('Económica'))).toBe(11_165_800)
  })

  it('Recomendada escogida: cuadra con `costo_total` de la cotización', () => {
    expect(presupuesto(seleccionDe('Recomendada'))).toBe(fixture.costo_total)
  })

  it('Premium escogida: la suya', () => {
    expect(presupuesto(seleccionDe('Premium'))).toBe(17_689_000)
  })

  it('sin tarifa escogida: todas las líneas, exactamente como antes', () => {
    expect(presupuesto(null)).toBe(31_387_140)
    expect(itemsDeLaTarifaAceptada(ITEMS, null)).toBe(ITEMS)
  })
})

describe('una cotización sin tarifas no cambia', () => {
  const SIN_TARIFAS: Item[] = [
    { id: 'a', grupo: null, cantidad: 2, subtotal: 100, rubros: [{ tipo: 'materiales', valor_total: 100 }] },
    { id: 'b', grupo: null, cantidad: 1, subtotal: 50, rubros: [] },
    { id: 'c', grupo: null, es_ajuste: true, cantidad: 1, subtotal: 999, rubros: [] },
  ]
  it('los ítems pasan intactos y el presupuesto es el de siempre', () => {
    expect(itemsDeLaTarifaAceptada(SIN_TARIFAS, null)).toBe(SIN_TARIFAS)
    expect(totalPresupuestado(calcularPresupuestoPorRubro(itemsDeLaTarifaAceptada(SIN_TARIFAS, null)))).toBe(250)
  })
  it('sin rubros cae al costo que se le pase, como antes con `costo_total`', () => {
    expect(presupuestoDeCosto([], 1_234)).toBe(1_234)
  })
})

describe('«Cotizado» y «Por cobrar»: el precio de la tarifa escogida', () => {
  it('con tarifa escogida manda el precio aprobado del negocio', () => {
    expect(precioDeLaCotizacionAceptada({ valorTotal: 16_551_976, conTarifaAceptada: true, precioAprobadoNegocio: 13_200_000 })).toBe(13_200_000)
  })
  it('sin tarifa escogida sigue siendo `valor_total`, aunque el negocio tenga otro precio (IVA de #830)', () => {
    expect(precioDeLaCotizacionAceptada({ valorTotal: 1_000_000, conTarifaAceptada: false, precioAprobadoNegocio: 1_190_000 })).toBe(1_000_000)
  })
  it('con tarifa escogida pero sin precio aprobado, cae a `valor_total`', () => {
    expect(precioDeLaCotizacionAceptada({ valorTotal: 500, conTarifaAceptada: true, precioAprobadoNegocio: null })).toBe(500)
  })
})
