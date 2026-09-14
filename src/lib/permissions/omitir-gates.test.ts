import { describe, it, expect } from 'vitest'
import { puedeOmitirGatesConMotivo, staffIdsQuePuedenOmitirGates } from './omitir-gates'

// Ids con la forma real de `staff.id`; no son personas de producción.
const DECLARADA = '00000000-0000-4000-8000-00000000000a'
const OTRA = '00000000-0000-4000-8000-00000000000b'

const conLista = (ids: unknown) => ({ omitir_gate: { staff_ids: ids } })

describe('puedeOmitirGatesConMotivo', () => {
  it('owner y admin pueden siempre, con o sin lista', () => {
    for (const role of ['owner', 'admin']) {
      expect(puedeOmitirGatesConMotivo({ role, staffId: OTRA }, null)).toBe(true)
      expect(puedeOmitirGatesConMotivo({ role, staffId: OTRA }, {})).toBe(true)
      expect(puedeOmitirGatesConMotivo({ role, staffId: OTRA }, conLista([]))).toBe(true)
      expect(puedeOmitirGatesConMotivo({ role, staffId: OTRA }, conLista([DECLARADA]))).toBe(true)
    }
  })

  it('un supervisor declarado en la lista puede', () => {
    expect(puedeOmitirGatesConMotivo({ role: 'supervisor', staffId: DECLARADA }, conLista([DECLARADA]))).toBe(true)
    expect(puedeOmitirGatesConMotivo({ role: 'supervisor', staffId: DECLARADA }, conLista([OTRA, DECLARADA]))).toBe(true)
  })

  it('un supervisor fuera de la lista no puede', () => {
    expect(puedeOmitirGatesConMotivo({ role: 'supervisor', staffId: OTRA }, conLista([DECLARADA]))).toBe(false)
  })

  it('lista vacía o ausente: nadie además de owner/admin (fail-closed)', () => {
    expect(puedeOmitirGatesConMotivo({ role: 'supervisor', staffId: DECLARADA }, conLista([]))).toBe(false)
    expect(puedeOmitirGatesConMotivo({ role: 'supervisor', staffId: DECLARADA }, {})).toBe(false)
    expect(puedeOmitirGatesConMotivo({ role: 'supervisor', staffId: DECLARADA }, null)).toBe(false)
    expect(puedeOmitirGatesConMotivo({ role: 'supervisor', staffId: DECLARADA }, undefined)).toBe(false)
  })

  it('sin staffId no hay a quién buscar en la lista', () => {
    // Un platform_admin en workspace ajeno opera con staffId null: no puede colarse
    // por una lista que contenga un vacío.
    expect(puedeOmitirGatesConMotivo({ role: 'supervisor', staffId: null }, conLista([DECLARADA]))).toBe(false)
    expect(puedeOmitirGatesConMotivo({ role: 'supervisor', staffId: '' }, conLista(['']))).toBe(false)
    expect(puedeOmitirGatesConMotivo({ role: null, staffId: undefined }, conLista([DECLARADA]))).toBe(false)
  })

  it('el rol no se infiere: supervisor u operator sin lista no heredan el permiso', () => {
    expect(puedeOmitirGatesConMotivo({ role: 'operator', staffId: DECLARADA }, null)).toBe(false)
    expect(puedeOmitirGatesConMotivo({ role: 'operator', staffId: DECLARADA }, conLista([DECLARADA]))).toBe(true)
  })
})

describe('staffIdsQuePuedenOmitirGates', () => {
  it('lee la clave omitir_gate.staff_ids', () => {
    expect(staffIdsQuePuedenOmitirGates(conLista([DECLARADA, OTRA]))).toEqual([DECLARADA, OTRA])
  })

  it('una forma mal cargada no abre el permiso a nadie', () => {
    expect(staffIdsQuePuedenOmitirGates(conLista(DECLARADA))).toEqual([])
    expect(staffIdsQuePuedenOmitirGates(conLista({ 0: DECLARADA }))).toEqual([])
    expect(staffIdsQuePuedenOmitirGates({ omitir_gate: DECLARADA })).toEqual([])
    expect(staffIdsQuePuedenOmitirGates({ omitir_gate: null })).toEqual([])
    expect(staffIdsQuePuedenOmitirGates('omitir_gate')).toEqual([])
    expect(staffIdsQuePuedenOmitirGates(conLista([DECLARADA, 7, null, '', '  ']))).toEqual([DECLARADA])
  })

  it('otras claves parecidas no cuentan', () => {
    // La lista de corrección de precio es otro permiso: no debe abrir este.
    expect(staffIdsQuePuedenOmitirGates({ correccion_precio: { staff_ids: [DECLARADA] } })).toEqual([])
    expect(staffIdsQuePuedenOmitirGates({ omitir_gates: { staff_ids: [DECLARADA] } })).toEqual([])
  })
})
