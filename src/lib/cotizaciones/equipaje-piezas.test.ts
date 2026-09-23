/**
 * P3 del ensayo del 2026-09-23 (caso Providencia): el equipaje guarda cantidad y peso.
 *
 * La lectura guardaba «Equipaje de mano: Sí» y «Equipaje de bodega: Sí» cuando la captura
 * decía «1 de 10 kg» y «1 de 23 kg». Las pruebas usan la lectura REAL de las capturas del
 * ensayo (`providencia-equipaje.fixture.json`, grabada con el mismo prompt de producción):
 * la de Wingo no trae bodega, y ese «No incluido» tiene que quedar dicho, no vacío.
 */
import { describe, expect, it } from 'vitest'

import fixture from './providencia-equipaje.fixture.json'
import { equipajeDeCampos, leerTramos, tramosDeCampos } from './tramos-vuelo'
import { equipajeDeTramo } from './detalle-viaje'
import { resumenDeLinea } from './lectura-pantallazo'
import { ranuraPorSlug } from './ranuras-pantallazo'

const WINGO = (fixture as unknown as Record<string, Record<string, string | null>>)['03-vuelo1-bog-adz-wingo.png']
const AVIANCA = (fixture as unknown as Record<string, Record<string, string | null>>)['01-vuelo1-bog-adz-avianca.png']

const valor = (c: Record<string, string | null>) => (slug: string) => c[slug] ?? null

describe('el equipaje con cantidad y peso (P3)', () => {
  it('Wingo, que no trae bodega: «No incluido» queda EXPLÍCITO, no como hueco', () => {
    const { tramos } = tramosDeCampos(valor(WINGO))
    const e = tramos[0].equipaje
    expect(e.bodega).toBe(false)
    expect(e.piezas?.bodega).toEqual({ cantidad: 0, pesoKg: null })
    expect(e.mano).toBe(false)
    expect(e.piezas?.mano).toEqual({ cantidad: 0, pesoKg: null })
    expect(e.personal).toBe(true)
    expect(e.piezas?.personal).toEqual({ cantidad: 1, pesoKg: null })
    // El regreso lleva el mismo equipaje.
    expect(tramos[1].equipaje).toEqual(e)
  })

  it('Avianca: «1 de 10 kg» y «1 de 23 kg» se guardan como cantidad y peso', () => {
    const e = tramosDeCampos(valor(AVIANCA)).tramos[0].equipaje
    expect(e.piezas?.mano).toEqual({ cantidad: 1, pesoKg: 10 })
    expect(e.piezas?.bodega).toEqual({ cantidad: 1, pesoKg: 23 })
  })

  it('el cliente lee el peso, no un «Sí»', () => {
    expect(equipajeDeTramo(tramosDeCampos(valor(AVIANCA)).tramos[0].equipaje))
      .toBe('artículo personal + equipaje de mano de 10 kg + equipaje de bodega de 23 kg')
    expect(equipajeDeTramo(tramosDeCampos(valor(WINGO)).tramos[0].equipaje)).toBe('artículo personal')
  })

  it('la descripción de la línea también dice el peso', () => {
    const vuelo = ranuraPorSlug('vuelo_detalle')!
    const campos = (c: Record<string, string | null>) =>
      Object.entries(c).map(([slug, v]) => ({ slug, label: slug, valor: v, confidence: 1, alertaRevision: false }))
    expect(resumenDeLinea(vuelo, campos(AVIANCA)).descripcion).toContain('Con equipaje de bodega de 23 kg, con equipaje de mano de 10 kg')
    expect(resumenDeLinea(vuelo, campos(WINGO)).descripcion).toContain('Solo artículo personal (sin equipaje de mano ni de bodega)')
  })

  it('se guarda y se vuelve a leer igual de `items.tramos`', () => {
    const { tramos } = tramosDeCampos(valor(AVIANCA))
    expect(leerTramos(JSON.parse(JSON.stringify(tramos)))).toEqual(tramos)
  })

  it('un tramo guardado ANTES de las piezas se sigue leyendo, y se dice como antes', () => {
    const viejo = [{
      sentido: 'ida', origen: 'BOG', destino: 'ADZ', fecha: null, salida: null, llegada: null,
      numero: null, escala: null, directo: null, equipaje: { personal: true, mano: true, bodega: false },
    }]
    const t = leerTramos(viejo)
    expect(t).not.toBeNull()
    expect(t![0].equipaje.piezas).toBeUndefined()
    expect(equipajeDeTramo(t![0].equipaje)).toBe('artículo personal + equipaje de mano')
  })

  it('unas piezas mal formadas invalidan el tramo entero, como el resto de la forma', () => {
    const roto = [{
      sentido: 'ida', origen: null, destino: null, fecha: null, salida: null, llegada: null,
      numero: null, escala: null, directo: null,
      equipaje: { personal: true, mano: null, bodega: null, piezas: { personal: { cantidad: 'uno' } } },
    }]
    expect(leerTramos(roto)).toBeNull()
  })

  it('un «no incluido» sin cantidad escrita (solo el icono apagado) se guarda como 0 piezas', () => {
    const e = equipajeDeCampos(s => ({ equipaje_bodega: 'false', equipaje_bodega_kg: '23' } as Record<string, string>)[s])
    expect(e.piezas?.bodega).toEqual({ cantidad: 0, pesoKg: null })
  })

  it('incluido con cero piezas se contradice: la cantidad queda vacía (hueco antes que mentira)', () => {
    const e = equipajeDeCampos(s => ({ equipaje_bodega: 'true', equipaje_bodega_cantidad: '0' } as Record<string, string>)[s])
    expect(e.bodega).toBe(true)
    expect(e.piezas?.bodega.cantidad).toBeNull()
  })

  it('una cantidad leída sin el sí/no lo decide: 0 es no incluido, 2 es incluido', () => {
    const e = equipajeDeCampos(s => ({ equipaje_mano_cantidad: '0', equipaje_bodega_cantidad: '2', equipaje_bodega_kg: '23' } as Record<string, string>)[s])
    expect(e.mano).toBe(false)
    expect(e.bodega).toBe(true)
    expect(equipajeDeTramo(e)).toBe('2 × equipaje de bodega de 23 kg')
  })
})
