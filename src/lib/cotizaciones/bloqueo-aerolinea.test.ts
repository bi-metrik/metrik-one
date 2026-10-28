import { describe, expect, it } from 'vitest'

import pegada from './__fixtures__/bloqueo/aliados-vuelos-aerolinea-pegada.json'
import { aerolineaLegible, PROMPT_VUELO_BLOQUEO, vueloDesdeLectura } from './bloqueo-extraccion'

// Prueba en producción del 2026-10-28: con el pantallazo de Aliados (logo «JS» de JetSMART y su
// código «JA» al lado) el modelo devolvió «JSJA» como aerolínea. Sin llamar al modelo.

describe('la aerolínea del vuelo de bloqueo', () => {
  it('el pantallazo de Aliados queda «JetSMART» en los dos tramos', () => {
    const r = vueloDesdeLectura(pegada)
    if (!r.ok) throw new Error(r.motivo)
    expect(r.vuelo.tramos.map(t => t.aerolinea)).toEqual(['JetSMART', 'JetSMART'])
  })

  it('el nombre comercial sin el código IATA ni las letras del logo', () => {
    expect(aerolineaLegible('JSJA')).toBe('JetSMART')
    expect(aerolineaLegible('JS JA')).toBe('JetSMART')
    expect(aerolineaLegible('JetSMART JA')).toBe('JetSMART')
    expect(aerolineaLegible('jetsmart')).toBe('JetSMART')
    expect(aerolineaLegible('Avianca (AV)')).toBe('Avianca')
    expect(aerolineaLegible('AVIANCA AV')).toBe('Avianca')
    expect(aerolineaLegible('LATAM Airlines')).toBe('LATAM')
    expect(aerolineaLegible('LATAM LA')).toBe('LATAM')
    expect(aerolineaLegible('Wingo P5')).toBe('Wingo')
    expect(aerolineaLegible('Copa Airlines CM')).toBe('Copa')
  })

  it('si solo hay un código, queda el código: no se inventa el nombre', () => {
    expect(aerolineaLegible('JA')).toBe('JA')
    expect(aerolineaLegible('JS')).toBe('JS')
    expect(aerolineaLegible('AV')).toBe('AV')
  })

  it('lo que no reconoce queda tal cual; vacío es null', () => {
    expect(aerolineaLegible('Aerolínea Ficticia')).toBe('Aerolínea Ficticia')
    expect(aerolineaLegible('  ')).toBeNull()
    expect(aerolineaLegible(null)).toBeNull()
  })

  it('la instrucción pide el nombre comercial, sin código pegado, y el código tal cual si es lo único', () => {
    expect(PROMPT_VUELO_BLOQUEO).toContain('nombre comercial')
    expect(PROMPT_VUELO_BLOQUEO).toContain('JetSMART, no «JSJA»')
    expect(PROMPT_VUELO_BLOQUEO).toMatch(/Si solo se ve un código .* devuelve el código tal cual/)
  })
})
