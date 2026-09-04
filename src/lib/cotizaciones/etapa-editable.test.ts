import { describe, it, expect } from 'vitest'
import { hayCotizacionEditableEnEtapa } from './etapa-editable'

describe('hayCotizacionEditableEnEtapa', () => {
  it('sí cuando la etapa declara el bloque de cotización editable', () => {
    expect(
      hayCotizacionEditableEnEtapa([
        { tipo: 'datos', estado: 'editable' },
        { tipo: 'cotizacion', estado: 'editable' },
      ]),
    ).toBe(true)
  })

  it('no cuando el bloque de cotización de esa etapa es de solo lectura', () => {
    // Es el caso de Aprobación en adelante: el bloque se ve, no se trabaja.
    expect(
      hayCotizacionEditableEnEtapa([
        { tipo: 'cotizacion', estado: 'visible' },
        { tipo: 'documento', estado: 'editable' },
      ]),
    ).toBe(false)
  })

  it('no cuando la etapa no tiene bloque de cotización', () => {
    expect(hayCotizacionEditableEnEtapa([{ tipo: 'cobros', estado: 'editable' }])).toBe(false)
  })

  it('no cuenta un bloque de cotización desactivado', () => {
    // `desactivado` saca el bloque del flujo sin borrarlo: si no se trabaja, no habilita.
    expect(
      hayCotizacionEditableEnEtapa([
        { tipo: 'cotizacion', estado: 'editable', desactivado: true },
      ]),
    ).toBe(false)
  })

  it('una etapa sin bloques no habilita nada', () => {
    expect(hayCotizacionEditableEnEtapa([])).toBe(false)
  })

  it('tolera tipo o estado ausentes sin habilitar', () => {
    expect(hayCotizacionEditableEnEtapa([{ tipo: null, estado: null }])).toBe(false)
    expect(hayCotizacionEditableEnEtapa([{ tipo: 'cotizacion' }])).toBe(false)
  })
})
