import { describe, it, expect } from 'vitest'
import { puedeAsignarResponsable, staffIdsQuePuedenAsignarResponsable } from './asignar-responsable'

// Ids con la forma real de `staff.id`; no son personas de producción.
const DECLARADA = '00000000-0000-4000-8000-00000000000a'
const OTRA = '00000000-0000-4000-8000-00000000000b'

const conLista = (ids: unknown) => ({ asignar_responsable: { staff_ids: ids } })

describe('puedeAsignarResponsable', () => {
  it('owner, admin y supervisor pueden siempre, con o sin lista', () => {
    for (const role of ['owner', 'admin', 'supervisor']) {
      expect(puedeAsignarResponsable({ role, staffId: OTRA }, null)).toBe(true)
      expect(puedeAsignarResponsable({ role, staffId: OTRA }, undefined)).toBe(true)
      expect(puedeAsignarResponsable({ role, staffId: OTRA }, {})).toBe(true)
      expect(puedeAsignarResponsable({ role, staffId: OTRA }, conLista([]))).toBe(true)
      expect(puedeAsignarResponsable({ role, staffId: OTRA }, conLista([DECLARADA]))).toBe(true)
      expect(puedeAsignarResponsable({ role, staffId: null }, conLista('roto'))).toBe(true)
    }
  })

  it('operator sin lista no puede (el rol no se infiere)', () => {
    expect(puedeAsignarResponsable({ role: 'operator', staffId: DECLARADA }, null)).toBe(false)
    expect(puedeAsignarResponsable({ role: 'operator', staffId: DECLARADA }, undefined)).toBe(false)
    expect(puedeAsignarResponsable({ role: 'operator', staffId: DECLARADA }, {})).toBe(false)
  })

  it('operator declarado en la lista puede', () => {
    expect(puedeAsignarResponsable({ role: 'operator', staffId: DECLARADA }, conLista([DECLARADA]))).toBe(true)
    expect(puedeAsignarResponsable({ role: 'operator', staffId: DECLARADA }, conLista([OTRA, DECLARADA]))).toBe(true)
  })

  it('la comparación no depende de mayúsculas', () => {
    expect(puedeAsignarResponsable({ role: 'operator', staffId: DECLARADA }, conLista([DECLARADA.toUpperCase()]))).toBe(true)
    expect(puedeAsignarResponsable({ role: 'operator', staffId: DECLARADA.toUpperCase() }, conLista([DECLARADA]))).toBe(true)
  })

  it('operator fuera de la lista no puede', () => {
    expect(puedeAsignarResponsable({ role: 'operator', staffId: OTRA }, conLista([DECLARADA]))).toBe(false)
  })

  it('lista vacía o ausente: nadie además de owner/admin/supervisor (fail-closed)', () => {
    expect(puedeAsignarResponsable({ role: 'operator', staffId: DECLARADA }, conLista([]))).toBe(false)
    expect(puedeAsignarResponsable({ role: 'operator', staffId: DECLARADA }, { asignar_responsable: {} })).toBe(false)
  })

  it('lista mal formada no abre el permiso', () => {
    const op = { role: 'operator', staffId: DECLARADA }
    expect(puedeAsignarResponsable(op, conLista(DECLARADA))).toBe(false)
    expect(puedeAsignarResponsable(op, conLista({ 0: DECLARADA }))).toBe(false)
    expect(puedeAsignarResponsable(op, conLista(null))).toBe(false)
    expect(puedeAsignarResponsable(op, { asignar_responsable: [DECLARADA] })).toBe(false)
    expect(puedeAsignarResponsable(op, { asignar_responsable: DECLARADA })).toBe(false)
    expect(puedeAsignarResponsable(op, 'asignar_responsable')).toBe(false)
  })

  it('sin staffId no hay a quién buscar en la lista', () => {
    // Un platform_admin en workspace ajeno opera con staffId null.
    expect(puedeAsignarResponsable({ role: 'operator', staffId: null }, conLista([DECLARADA]))).toBe(false)
    expect(puedeAsignarResponsable({ role: 'operator', staffId: '' }, conLista(['']))).toBe(false)
    expect(puedeAsignarResponsable({ role: null, staffId: undefined }, conLista([DECLARADA]))).toBe(false)
  })
})

describe('staffIdsQuePuedenAsignarResponsable', () => {
  it('lee la clave asignar_responsable.staff_ids', () => {
    expect(staffIdsQuePuedenAsignarResponsable(conLista([DECLARADA, OTRA]))).toEqual([DECLARADA, OTRA])
  })

  it('de una lista solo conserva los uuid', () => {
    expect(
      staffIdsQuePuedenAsignarResponsable(conLista([DECLARADA, 7, null, '', '  ', 'no-es-uuid', { id: OTRA }, [OTRA]])),
    ).toEqual([DECLARADA])
  })

  it('otras claves parecidas no cuentan', () => {
    // La lista de omitir gates es otro permiso: no debe abrir este.
    expect(staffIdsQuePuedenAsignarResponsable({ omitir_gate: { staff_ids: [DECLARADA] } })).toEqual([])
    expect(staffIdsQuePuedenAsignarResponsable({ asignar_responsables: { staff_ids: [DECLARADA] } })).toEqual([])
  })
})
