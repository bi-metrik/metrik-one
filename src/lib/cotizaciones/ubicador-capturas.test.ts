/**
 * La fila que ubica las capturas de la bandeja (bug #859, COT-2026-0011).
 *
 * Lo que se fija:
 *  1. hotel → × → hotel abre una ranura NUEVA: la ranura borrada deja de ser candidata.
 *     Antes la memoria solo crecía y el segundo hotel iba como «hermana» a un grupo muerto.
 *  2. Tres hoteles pegados a la vez dan UNA ranura con tres opciones (la fila los serializa).
 *  3. Red de seguridad: si la ranura elegida ya no tiene opciones (SIN_OPCIONES), se crea una
 *     nueva y el error no llega al asesor.
 *  4. Olvidar una opción que no es la última no olvida la ranura.
 */
import { describe, expect, it } from 'vitest'

import { crearUbicador, SIN_OPCIONES, type RanuraExistente } from './ubicador-capturas'
import type { CapturaDetectada } from './bandeja-capturas'

const HOTEL: CapturaDetectada = { tipo: 'hotel', lugar: null, origen: null, destino: null }

/** Acciones de mentira sobre una "base" en memoria: grupo → opciones vivas. */
function base() {
  const ranuras = new Map<string, string[]>()
  let n = 0
  const llamadas = { crear: 0, agregar: 0 }
  const acciones = {
    crear: async (c: CapturaDetectada) => {
      llamadas.crear++
      await new Promise(r => setTimeout(r, 5))
      const grupo = ranuras.size === 0 && !ranuras.has(c.tipo) ? c.tipo : `${c.tipo} ${ranuras.size + 1}`
      const itemId = `item-${++n}`
      ranuras.set(grupo, [itemId])
      return { success: true as const, itemId, grupo, etiqueta: `Hotel (${grupo})` }
    },
    agregar: async (grupo: string) => {
      llamadas.agregar++
      await new Promise(r => setTimeout(r, 5))
      const vivas = ranuras.get(grupo)
      if (!vivas || vivas.length === 0) {
        return { success: false as const, error: 'Esa ranura ya no tiene opciones', codigo: SIN_OPCIONES }
      }
      const itemId = `item-${++n}`
      vivas.push(itemId)
      return { success: true as const, itemId, grupo }
    },
  }
  const borrar = (itemId: string) => {
    for (const [g, ids] of ranuras) {
      const i = ids.indexOf(itemId)
      if (i >= 0) ids.splice(i, 1)
      if (ids.length === 0) ranuras.delete(g)
    }
  }
  return { ranuras, acciones, borrar, llamadas }
}

describe('ubicador de capturas', () => {
  it('hotel → × → hotel abre una ranura nueva, sin tocar el grupo muerto', async () => {
    const b = base()
    const u = crearUbicador(b.acciones)
    const primero = await u.ubicar(HOTEL, [])
    expect(primero.ok && primero.como).toBe('nueva')
    const itemId = primero.ok ? primero.itemId : ''

    b.borrar(itemId)
    u.olvidarOpcion(itemId)
    expect(u.recordadas()).toEqual([])

    const segundo = await u.ubicar(HOTEL, [])
    expect(segundo.ok && segundo.como).toBe('nueva')
    expect(b.llamadas.agregar).toBe(0)
    expect(b.llamadas.crear).toBe(2)
  })

  it('tres hoteles pegados a la vez: una ranura con tres opciones', async () => {
    const b = base()
    const u = crearUbicador(b.acciones)
    const r = await Promise.all([u.ubicar(HOTEL, []), u.ubicar(HOTEL, []), u.ubicar(HOTEL, [])])
    expect(r.every(x => x.ok)).toBe(true)
    expect(b.llamadas.crear).toBe(1)
    expect(b.llamadas.agregar).toBe(2)
    expect(b.ranuras.size).toBe(1)
    expect([...b.ranuras.values()][0]).toHaveLength(3)
    const grupos = new Set(r.map(x => (x.ok ? x.grupo : null)))
    expect(grupos.size).toBe(1)
  })

  it('si la ranura elegida murió por fuera (SIN_OPCIONES), abre una nueva sin avisar error', async () => {
    const b = base()
    const u = crearUbicador(b.acciones)
    const primero = await u.ubicar(HOTEL, [])
    const itemId = primero.ok ? primero.itemId : ''
    // Se borró en su bloque, no desde la bandeja: la fila no se enteró.
    b.borrar(itemId)

    const segundo = await u.ubicar(HOTEL, [])
    expect(segundo.ok).toBe(true)
    expect(segundo.ok && segundo.como).toBe('nueva')
    expect(b.llamadas.agregar).toBe(1)
    expect(b.llamadas.crear).toBe(2)
  })

  it('olvidar una opción que no es la última conserva la ranura', async () => {
    const b = base()
    const u = crearUbicador(b.acciones)
    const [a, c] = await Promise.all([u.ubicar(HOTEL, []), u.ubicar(HOTEL, [])])
    const idA = a.ok ? a.itemId : ''
    b.borrar(idA)
    u.olvidarOpcion(idA)
    expect(u.recordadas()).toHaveLength(1)

    const tercero = await u.ubicar(HOTEL, [])
    expect(tercero.ok && tercero.como).toBe('hermana')
    expect(tercero.ok && c.ok && tercero.grupo).toBe(c.ok ? c.grupo : null)
  })

  it('la etiqueta de la hermana es el nombre real de la ranura en la base', async () => {
    const b = base()
    const u = crearUbicador(b.acciones)
    b.ranuras.set('hotel', ['item-x'])
    const existentes: RanuraExistente[] = [{ grupo: 'hotel', etiqueta: 'Hotel en Providencia', lugar: null, origen: null, destino: null }]
    const r = await u.ubicar(HOTEL, existentes)
    expect(r.ok && r.como).toBe('hermana')
    expect(r.ok && r.etiqueta).toBe('Hotel en Providencia')
  })
})
