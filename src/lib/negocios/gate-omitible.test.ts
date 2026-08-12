import { describe, it, expect } from 'vitest'
import { puedeOmitirGate, marcaOmitido, describirOmision, estaOmitido, CLAVE_OMITIDO } from './gate-omitible'

// Config real (SOENA, Notificación): el aviso del enlace de la DIAN vence cuando
// la cita ya llegó. Lo declara vencido operaciones, que es quien tiene la fecha.
const AVISO_ENLACE = {
  omitible_por: {
    areas: ['operaciones'],
    motivo: 'cita_previa',
    label: 'No aplica: la cita llegó antes',
  },
}
// El gate de la fecha NO es omitible: ese dato el proceso lo necesita después.
const FECHA_CITA = { fields: [{ slug: 'fecha_cita_dian', required: true }] }

describe('puedeOmitirGate', () => {
  it('operaciones puede declarar vencido el aviso', () => {
    expect(puedeOmitirGate(AVISO_ENLACE, { role: 'operator', areas: ['operaciones'] })).toBe(true)
    expect(puedeOmitirGate(AVISO_ENLACE, { role: 'supervisor', areas: ['operaciones'] })).toBe(true)
  })

  it('el área dueña del bloque NO lo omite: a ella le toca hacerlo', () => {
    expect(puedeOmitirGate(AVISO_ENLACE, { role: 'operator', areas: ['comercial'] })).toBe(false)
  })

  it('un gate sin la marca NUNCA es omitible, ni por operaciones', () => {
    expect(puedeOmitirGate(FECHA_CITA, { role: 'supervisor', areas: ['operaciones'] })).toBe(false)
    expect(puedeOmitirGate(null, { role: 'owner', areas: [] })).toBe(false)
  })

  it('la marca sin áreas declaradas no abre nada', () => {
    expect(puedeOmitirGate({ omitible_por: { motivo: 'x' } }, { role: 'owner', areas: ['operaciones'] })).toBe(false)
    expect(puedeOmitirGate({ omitible_por: { areas: [] } }, { role: 'owner', areas: ['operaciones'] })).toBe(false)
  })

  it('read_only y contador quedan fuera, aunque tengan el área', () => {
    expect(puedeOmitirGate(AVISO_ENLACE, { role: 'read_only', areas: ['operaciones'] })).toBe(false)
    expect(puedeOmitirGate(AVISO_ENLACE, { role: 'contador', areas: ['operaciones'] })).toBe(false)
  })

  it('dirección alcanza porque expande a las tres áreas operativas', () => {
    expect(puedeOmitirGate(AVISO_ENLACE, { role: 'supervisor', areas: ['direccion'] })).toBe(true)
  })

  it('un usuario sin áreas no omite: la omisión se justifica por el trabajo, no por el rol', () => {
    expect(puedeOmitirGate(AVISO_ENLACE, { role: 'owner', areas: [] })).toBe(false)
  })
})

describe('la marca que queda', () => {
  it('guarda motivo, etiqueta, autor y fecha', () => {
    const m = marcaOmitido(AVISO_ENLACE, { id: 'staff-1', nombre: 'Jhon' }, '2026-08-10T21:00:00Z')
    expect(m).toEqual({
      motivo: 'cita_previa',
      label: 'No aplica: la cita llegó antes',
      por_id: 'staff-1',
      por_nombre: 'Jhon',
      fecha: '2026-08-10T21:00:00Z',
    })
  })

  it('con config incompleta usa un respaldo legible, no undefined', () => {
    expect(describirOmision({ omitible_por: { areas: ['operaciones'] } }))
      .toEqual({ motivo: 'no_aplica', label: 'No aplica' })
  })

  it('se reconoce después en el data del bloque', () => {
    const m = marcaOmitido(AVISO_ENLACE, { id: null, nombre: null }, '2026-08-10T21:00:00Z')
    expect(estaOmitido({ [CLAVE_OMITIDO]: m })?.motivo).toBe('cita_previa')
  })

  it('un bloque completado de verdad NO se confunde con uno omitido', () => {
    expect(estaOmitido({ aviso_enviado: true })).toBeNull()
    expect(estaOmitido(null)).toBeNull()
  })
})
