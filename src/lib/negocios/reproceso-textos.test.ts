import { describe, it, expect } from 'vitest'
import { avisoDelRetorno, contenidoErrorSinRetorno, MAX_CONTENIDO_ACTIVIDAD } from './reproceso-textos'

describe('avisoDelRetorno', () => {
  const base = { declarada: 'Cita', efectiva: 'Anexos', seccional: 'Manizales' }

  it('retorno declarado: no hay nada que explicar', () => {
    expect(avisoDelRetorno({ ...base, motivo: 'aplica', efectiva: 'Cita' })).toBeNull()
    expect(avisoDelRetorno({ ...base, motivo: 'aplica_derivado', efectiva: 'Cita' })).toBeNull()
    expect(avisoDelRetorno({ ...base, motivo: 'sin_bifurcacion', efectiva: 'Cita' })).toBeNull()
  })

  it('desvío por respuesta registrada', () => {
    expect(avisoDelRetorno({ ...base, motivo: 'no_aplica' })).toBe(
      'Este caso no pasa por Cita según su ruta registrada, así que vuelve a Anexos.',
    )
  })

  it('desvío por seccional: lo dice y pide revisar', () => {
    expect(avisoDelRetorno({ ...base, motivo: 'no_aplica_derivado' })).toBe(
      'Este caso no pasa por Cita (seccional Manizales), así que vuelve a Anexos. No tenía la respuesta registrada: revísalo.',
    )
  })

  it('sin respuesta: vuelve a la declarada y avisa', () => {
    expect(avisoDelRetorno({ ...base, motivo: 'sin_respuesta', efectiva: 'Cita', seccional: null })).toContain('Revísalo')
  })
})

describe('contenidoErrorSinRetorno', () => {
  it('V0388: dice que el caso no se movió', () => {
    expect(
      contenidoErrorSinRetorno({
        tipo: 'Devolución DIAN',
        causa: 'error_propio',
        etapaActual: 'Envío',
        detalle: 'No se envió la documentación antes de la cita del 8-sep.',
      }),
    ).toBe(
      'Error registrado sin devolver el caso — Devolución DIAN. Causa: error propio. El caso sigue en Envío. ' +
        'No se envió la documentación antes de la cita del 8-sep.',
    )
  })

  it('un detalle largo se corta para caber en el CHECK de 280', () => {
    const c = contenidoErrorSinRetorno({
      tipo: 'Devolución DIAN',
      causa: 'error_propio',
      etapaActual: 'Envío',
      detalle: 'x'.repeat(600),
    })
    expect(c.length).toBeLessThanOrEqual(MAX_CONTENIDO_ACTIVIDAD)
    expect(c.endsWith('…')).toBe(true)
  })
})
