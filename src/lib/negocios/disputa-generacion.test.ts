import { describe, expect, it } from 'vitest'
import { motivoGeneracionNegada } from './disputa-generacion'
import type { ResultadoVoto } from './votos'

const VOTO = {
  slug: 'documento_titular',
  label: 'Documento del titular',
  estado: 'dudosa',
  valor: '1022424269',
  fuentes: [],
  bloquea: false,
  niega_generacion: true,
  mensaje: 'Documento del titular: lectura dudosa en RUT (casilla 26) (1022424289). Factura y Certificado UPME dicen 1022424269.',
} satisfies ResultadoVoto

describe('motivoGeneracionNegada', () => {
  it('sin votos en disputa, se genera', () => {
    expect(motivoGeneracionNegada([])).toBeNull()
  })

  it('con uno, dice cuál dato y dónde se corrige', () => {
    const m = motivoGeneracionNegada([VOTO])!
    expect(m).toContain('No se genera el documento')
    expect(m).toContain('RUT (casilla 26) (1022424289)')
    expect(m).toContain('Datos clave')
  })
})
