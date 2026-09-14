import { describe, it, expect } from 'vitest'

import {
  estadoDelRecargo,
  lineaDeRecargo,
  politicaRecargoDeLinea,
  recargoCorresponde,
  RECARGO_POR_DEFECTO,
} from './recargo-linea'
import { calcularCascada } from './totales'
import { itemsQueAportanAlTotal } from './itinerarios'

/**
 * Regla 2 de la reunión del 2026-09-14: el recargo fijo, configurable y editable.
 *
 * Lo que estas pruebas fijan, en orden de importancia:
 *  1. Sin configuración NO pasa nada, en ningún workspace.
 *  2. Es INGRESO: suma al precio y no al costo, y el margen sube lo que el recargo vale.
 *  3. Se ve cuándo la línea lleva un valor distinto del vigente.
 */

const CONFIG = {
  margen: { convencion: 'sobre_venta', default_pct: 15 },
  recargo: { activo: true, etiqueta: 'Recargo de emisión', valor: 100_000, aplica_a: ['vuelo_detalle'] },
}

const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  nombre: 'Vuelo BOG-PUJ',
  grupo: 'vuelo' as string | null,
  precio_venta: 0,
  cantidad: 1,
  es_ajuste: false,
  ...over,
})

describe('dónde vive el valor por defecto', () => {
  it('lo lee de `config_extra.recargo` de la línea', () => {
    expect(politicaRecargoDeLinea(CONFIG)).toEqual({
      activo: true,
      etiqueta: 'Recargo de emisión',
      valor: 100_000,
      aplicaA: ['vuelo_detalle'],
    })
  })

  it('una línea que no declara nada queda APAGADA', () => {
    // La condición de todo mecanismo nuevo en este repo: ningún workspace cambia.
    expect(politicaRecargoDeLinea(null).activo).toBe(false)
    expect(politicaRecargoDeLinea({ margen: { default_pct: 15 } }).activo).toBe(false)
    expect(politicaRecargoDeLinea({})).toEqual(RECARGO_POR_DEFECTO)
  })

  it('un jsonb con otra forma no tumba nada ni enciende nada', () => {
    expect(politicaRecargoDeLinea({ recargo: 'sí' }).activo).toBe(false)
    expect(politicaRecargoDeLinea({ recargo: { activo: true } }).activo).toBe(false)
  })

  it('activo pero en cero NO se ofrece: obligaría a teclear el monto cada vez', () => {
    expect(politicaRecargoDeLinea({ recargo: { activo: true, valor: 0 } }).activo).toBe(false)
  })

  it('un valor negativo se descarta: un descuento fijo es otra decisión', () => {
    const p = politicaRecargoDeLinea({ recargo: { activo: true, valor: -50_000 } })
    expect(p.valor).toBe(0)
    expect(p.activo).toBe(false)
  })
})

describe('se aplica solo donde corresponde', () => {
  const politica = politicaRecargoDeLinea(CONFIG)

  it('con un vuelo, corresponde', () => {
    expect(recargoCorresponde([item()], politica)).toBe(true)
  })

  it('los sinónimos de la ranura también cuentan', () => {
    expect(recargoCorresponde([item({ grupo: 'tiquetes', nombre: 'Aéreos' })], politica)).toBe(true)
  })

  it('con solo hotel y traslado, NO corresponde', () => {
    const sinVuelo = [item({ id: 'h', grupo: 'hotel' }), item({ id: 't', grupo: 'traslado' })]
    expect(recargoCorresponde(sinVuelo, politica)).toBe(false)
  })

  it('un ítem sin grupo no dispara nada, aunque se llame «vuelo»', () => {
    // Mismo contrato que el pantallazo: sin ranura no hay decisión que tomar.
    expect(recargoCorresponde([item({ grupo: null, nombre: 'Vuelo a Madrid' })], politica)).toBe(false)
  })

  it('con el recargo apagado no corresponde nunca', () => {
    expect(recargoCorresponde([item()], RECARGO_POR_DEFECTO)).toBe(false)
  })
})

describe('el estado que la pantalla muestra', () => {
  const politica = politicaRecargoDeLinea(CONFIG)
  const recargoPuesto = (valor: number) =>
    item({ id: 'r', nombre: 'Recargo de emisión', grupo: null, precio_venta: valor })

  it('falta: hay vuelo y no está puesto', () => {
    expect(estadoDelRecargo([item()], politica)).toEqual({
      estado: 'falta', valor: 100_000, etiqueta: 'Recargo de emisión',
    })
  })

  it('puesto: la línea existe con el valor vigente', () => {
    const r = estadoDelRecargo([item(), recargoPuesto(100_000)], politica)
    expect(r.estado).toBe('puesto')
  })

  it('distinto: la línea lleva otro número, y se dicen LOS DOS', () => {
    const r = estadoDelRecargo([item(), recargoPuesto(150_000)], politica)
    expect(r).toEqual({
      estado: 'distinto',
      valorEnLaLinea: 150_000,
      valorVigente: 100_000,
      etiqueta: 'Recargo de emisión',
      itemId: 'r',
    })
  })

  it('lo reconoce sin tildes ni mayúsculas: el nombre es texto libre', () => {
    const r = estadoDelRecargo([item(), recargoPuesto(100_000)], politica)
    expect(r.estado).toBe('puesto')
    const conTildes = estadoDelRecargo(
      [item(), item({ id: 'r', nombre: 'RECARGO DE EMISION', grupo: null, precio_venta: 100_000 })],
      politica,
    )
    expect(conTildes.estado).toBe('puesto')
  })

  it('sin vuelo no dice nada, aunque la línea del recargo esté', () => {
    const r = estadoDelRecargo([item({ grupo: 'hotel' }), recargoPuesto(100_000)], politica)
    expect(r.estado).toBe('no_aplica')
  })

  it('el ítem de cuadre nunca se confunde con el recargo', () => {
    const ajuste = item({ id: 'aj', nombre: 'Recargo de emisión', grupo: null, es_ajuste: true, precio_venta: 100_000 })
    expect(lineaDeRecargo([ajuste], politica)).toBeNull()
  })
})

describe('el recargo es INGRESO: suma al precio, no al costo', () => {
  // Esta es la decisión que la reunión pidió explícita, y se prueba sobre la cascada
  // real: el recargo no puede pasar por el margen.
  const vuelo = {
    id: 'v', nombre: 'Vuelo', cantidad: 1, subtotal: 2_000_000, numeroDeRubros: 0,
    costoDeRubros: 0, precio_venta: 0, precio_manual: false, margen_porcentaje: null,
    descuento_porcentaje: 0, es_ajuste: false,
  }
  const recargo = {
    id: 'r', nombre: 'Recargo de emisión', cantidad: 1, subtotal: 0, numeroDeRubros: 0,
    costoDeRubros: 0, precio_venta: 100_000, precio_manual: true, margen_porcentaje: null,
    descuento_porcentaje: 0, es_ajuste: false,
  }
  const params = { margenPct: 15, convencionMargen: 'sobre_venta' as const }

  it('el costo NO se mueve: el recargo no es algo que se pague', () => {
    const sin = calcularCascada([vuelo], params)
    const con = calcularCascada([vuelo, recargo], params)
    expect(con.costoDirecto).toBe(sin.costoDirecto)
  })

  it('el precio sube EXACTAMENTE el recargo, sin margen encima', () => {
    const sin = calcularCascada([vuelo], params)
    const con = calcularCascada([vuelo, recargo], params)
    // Como costo con `sobre_venta` al 15% saldría cobrado en 117.647. Aquí son 100.000.
    expect(con.precioVenta - sin.precioVenta).toBe(100_000)
  })

  it('el margen SUBE: el recargo es utilidad, y eso es lo que la pantalla enseña', () => {
    const sin = calcularCascada([vuelo], params)
    const con = calcularCascada([vuelo, recargo], params)
    expect(sin.margenRealPct).toBeCloseTo(15, 1)
    expect(con.margenRealPct as number).toBeGreaterThan(sin.margenRealPct as number)
    // 2.352.941 + 100.000 = 2.452.941 de venta contra 2.000.000 de costo → 18,5%.
    expect(con.margenRealPct).toBeCloseTo(18.5, 1)
  })
})


describe('el recargo llega al PDF, y una sola vez', () => {
  // El PDF arma su lista con `itemsQueAportanAlTotal` (el mismo helper que escribe
  // `valor_total`), así que lo que se prueba aquí es exactamente lo que se imprime.
  const ids = (items: { id: string; grupo?: string | null; orden?: number }[]) =>
    itemsQueAportanAlTotal(items.map(i => ({ ...i, es_ajuste: false })))

  it('la línea del recargo APORTA: sin grupo, es un componente fijo', () => {
    const items = [
      { id: 'vuelo-a', grupo: 'vuelo', orden: 1 },
      { id: 'vuelo-b', grupo: 'vuelo', orden: 2 },
      { id: 'recargo', grupo: null, orden: 9 },
    ]
    expect(ids(items)).toEqual(['vuelo-a', 'recargo'])
  })

  it('CONTROL · con grupo propio, DOS recargos se cobrarían como uno solo', () => {
    // Por esto la línea nace sin `grupo`. Con grupo, los dos recargos serían
    // alternativas de la misma ranura y el segundo desaparecería del total.
    const conGrupo = [
      { id: 'r1', grupo: 'recargo', orden: 1 },
      { id: 'r2', grupo: 'recargo', orden: 2 },
    ]
    expect(ids(conGrupo)).toEqual(['r1'])
    const sinGrupo = [
      { id: 'r1', grupo: null, orden: 1 },
      { id: 'r2', grupo: null, orden: 2 },
    ]
    expect(ids(sinGrupo)).toEqual(['r1', 'r2'])
  })
})
