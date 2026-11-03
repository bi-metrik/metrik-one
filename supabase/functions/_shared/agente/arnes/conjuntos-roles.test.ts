import { describe, expect, it } from 'vitest'
import { casosDelRol } from './conjuntos-roles'
import { normal } from '../verificador'

/**
 * Un caso de «yo» mide quién lleva el viaje, no si se abre otro al mismo destino. md-yo pedía «a Madrid» para Martín
 * Mora, que en la semilla ya tiene M1 26 5 · MADRID abierto: desde #1383 Haiku preguntaba si era ese mismo (25 de 45 en
 * las corridas del 2026-11-03) y el caso fallaba por la semilla, no por el responsable.
 */
describe('casos de «yo» de los roles', () => {
  for (const [rol, id, cliente] of [['mano_derecha', 'md-yo', 'c-martin'], ['asesor_viajes', 'av-yo', 'c-martin']] as const) {
    it(`${id}: el destino pedido no es el de un viaje abierto del cliente`, () => {
      const caso = casosDelRol(rol).find((c) => c.id === id)!
      const pedido = normal(String((caso.pasos[0] as { escribe: string }).escribe))
      const abiertos = (caso.viajes ?? []).filter((v) => v.contactoId === cliente && v.abierto).map((v) => normal(String(v.nombre)))
      expect(abiertos.length).toBeGreaterThan(0)
      expect(abiertos.filter((d) => pedido.includes(d))).toEqual([])
      expect(pedido).toMatch(/\byo\b/)
    })
  }
})
