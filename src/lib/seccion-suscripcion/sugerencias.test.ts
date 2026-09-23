import { describe, expect, it } from 'vitest'
import { asuntoAvisoLead, descartadaHasta, mostrarSugerencia, textoAvisoLead } from './sugerencias'

const AHORA = new Date('2026-09-23T15:00:00Z')

describe('el bloque de Sustenta', () => {
  it('se muestra si nunca se descartó', () => {
    expect(mostrarSugerencia({ descartadaHasta: null, yaSolicitado: false, ahora: AHORA })).toBe(true)
  })

  it('«Ahora no» lo esconde 30 días y vuelve después', () => {
    const hasta = descartadaHasta(AHORA)
    expect(hasta).toBe('2026-10-23T15:00:00.000Z')
    expect(mostrarSugerencia({ descartadaHasta: hasta, yaSolicitado: false, ahora: new Date('2026-10-22T15:00:00Z') })).toBe(false)
    expect(mostrarSugerencia({ descartadaHasta: hasta, yaSolicitado: false, ahora: new Date('2026-10-23T15:00:00Z') })).toBe(true)
  })

  it('no se vuelve a ofrecer a quien ya pidió que lo contacten', () => {
    expect(mostrarSugerencia({ descartadaHasta: null, yaSolicitado: true, ahora: AHORA })).toBe(false)
  })

  it('una fecha ilegible no lo esconde para siempre', () => {
    expect(mostrarSugerencia({ descartadaHasta: 'x', yaSolicitado: false, ahora: AHORA })).toBe(true)
  })

  it('el aviso a MeTRIK dice quién, de qué empresa y cómo contactarlo, sin signos de exclamación', () => {
    const d = { empresa: 'CDA El Carmen', espacioSlug: 'cda-elcarmen', persona: 'Ana Ruiz', correo: 'ana@cda.co', rol: 'Administrador' }
    expect(asuntoAvisoLead(d)).toBe('[ONE · cda-elcarmen] CDA El Carmen quiere conocer Sustenta')
    expect(textoAvisoLead(d)).toContain('Correo: ana@cda.co')
    expect(textoAvisoLead(d)).not.toMatch(/[!¡]/)
  })
})
