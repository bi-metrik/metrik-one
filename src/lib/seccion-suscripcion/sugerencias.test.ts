import { describe, expect, it } from 'vitest'
import {
  asuntoAvisoLead,
  descartadaHasta,
  eventoDelNavegador,
  mostrarSugerencia,
  origenCta,
  primerNombre,
  textoAvisoLead,
  textoConfirmacion,
} from './sugerencias'

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
    expect(asuntoAvisoLead(d)).toBe('[ONE · cda-elcarmen] CDA El Carmen pidió una demostración de Sustenta')
    expect(textoAvisoLead(d)).toContain('Correo: ana@cda.co')
    expect(textoAvisoLead(d)).not.toMatch(/[!¡]/)
  })
})

describe('la confirmación de la demostración', () => {
  it('recién pedida lleva el primer nombre; sin nombre, no inventa uno', () => {
    expect(textoConfirmacion({ tipo: 'recien', nombre: 'Ana' })).toBe(
      'Listo, Ana. Mauricio Moreno, de MeTRIK, te escribirá para agendar la demostración.',
    )
    expect(textoConfirmacion({ tipo: 'recien', nombre: null })).toBe(
      'Listo. Mauricio Moreno, de MeTRIK, te escribirá para agendar la demostración.',
    )
  })

  it('pedida antes', () => {
    expect(textoConfirmacion({ tipo: 'previa' })).toBe('Ya recibimos tu solicitud. Te escribiremos para agendar la demostración.')
  })

  it('primerNombre', () => {
    expect(primerNombre('  Ana María Ruiz ')).toBe('Ana')
    expect(primerNombre('')).toBeNull()
    expect(primerNombre(null)).toBeNull()
  })
})

describe('los eventos que acepta el navegador', () => {
  it('solo vista y panel: el clic y el descarte los registra la acción que los ejecuta', () => {
    expect(eventoDelNavegador('vista')).toBe('vista')
    expect(eventoDelNavegador('panel')).toBe('panel')
    expect(eventoDelNavegador('cta')).toBeNull()
    expect(eventoDelNavegador('descarte')).toBeNull()
    expect(eventoDelNavegador({ evento: 'vista' })).toBeNull()
  })

  it('el origen del clic cae en la tarjeta si llega cualquier otra cosa', () => {
    expect(origenCta('panel')).toBe('panel')
    expect(origenCta('tarjeta')).toBe('tarjeta')
    expect(origenCta('<script>')).toBe('tarjeta')
    expect(origenCta(undefined)).toBe('tarjeta')
  })
})
