import { describe, it, expect } from 'vitest'
import { visiblePuedeNacerCompleto } from './bloque-visible-completo'

/**
 * Contrato entre la regla de TS y su espejo en SQL.
 *
 * O5 siembra la casilla de un bloque nuevo desde la base (los bloques nacen por migración,
 * no por UI, así que el disparo tiene que vivir en SQL). Eso obliga a tener la regla de
 * "¿con qué estado nace una casilla vacía?" en dos sitios, y dos sitios es exactamente la
 * deuda que ya costó cara con el ranking de calidad.
 *
 * Se acota así: el SQL (`bloque_nace_completo`, migración 20260802000001) replica esta
 * regla SOLO para el caso `data = {}`, que es el único que necesita. Esta tabla de casos es
 * el contrato — los MISMOS casos se corrieron contra la función SQL y dieron lo mismo.
 *
 * ⚠️ Este test comprueba el lado de TypeScript. NO ejecuta SQL: si alguien cambia la
 * función de la base sin tocar este archivo, esto sigue en verde. Por eso la migración
 * lleva el aviso "si cambia allá, cambia aquí", y por eso la comprobación cruzada se hace
 * al aplicar. Es una limitación real de este test, no una que convenga olvidar.
 */

/** Lo que hace el auto-init: `estado === 'visible' && visiblePuedeNacerCompleto(...)`. */
function naceCompleto(estado: string, esGate: boolean, fields: unknown[]): boolean {
  return estado === 'visible' && visiblePuedeNacerCompleto({ fields }, {}, esGate)
}

const CON_REQUERIDO = [{ slug: 'x', tipo: 'texto', required: true }]
const SIN_REQUERIDO = [{ slug: 'y', tipo: 'texto' }]

describe('con qué estado nace una casilla vacía', () => {
  it('un bloque editable nace PENDIENTE: lo responde una persona', () => {
    expect(naceCompleto('editable', false, SIN_REQUERIDO)).toBe(false)
    expect(naceCompleto('editable', true, CON_REQUERIDO)).toBe(false)
  })

  it('un bloque de solo lectura que no retiene nace COMPLETO', () => {
    // Lo llena el sistema y no decide nada: dejarlo pendiente sería ruido en cada caso.
    expect(naceCompleto('visible', false, SIN_REQUERIDO)).toBe(true)
    expect(naceCompleto('visible', false, CON_REQUERIDO)).toBe(true)
  })

  it('un GATE de solo lectura con campo obligatorio nace PENDIENTE', () => {
    // El caso que originó todo: si naciera completo, el gate no retendría y el negocio
    // avanzaría con la pregunta sin responder, cayendo al default del routing.
    expect(naceCompleto('visible', true, CON_REQUERIDO)).toBe(false)
  })

  it('un GATE de solo lectura sin campos obligatorios nace COMPLETO', () => {
    expect(naceCompleto('visible', true, SIN_REQUERIDO)).toBe(true)
    expect(naceCompleto('visible', true, [])).toBe(true)
  })
})
