import { describe, it, expect } from 'vitest'
import { candidatosDeToken, huella, motivoSinToken } from './token'

const h = (init: Record<string, string> = {}) => new Headers(init)
const q = (s = '') => new URLSearchParams(s)

describe('candidatosDeToken', () => {
  it('REGRESION: una cabecera authorization ajena no tapa el ?token= valido', () => {
    // Exactamente lo que manda FunnelChat: authorization propia, sin x-metrik-token.
    const c = candidatosDeToken(h({ authorization: 'algo-de-funnelchat' }), q('token=fc_bueno'))
    expect(c.map((x) => x.valor)).toContain('fc_bueno')
    expect(c[0].valor).toBe('fc_bueno')
  })

  it('la cabecera propia gana sobre la query', () => {
    const c = candidatosDeToken(h({ 'x-metrik-token': 'por-cabecera' }), q('token=por-query'))
    expect(c[0]).toEqual({ origen: 'x-metrik-token', valor: 'por-cabecera' })
    expect(c[1]).toEqual({ origen: 'query:token', valor: 'por-query' })
  })

  it('authorization solo cuenta como Bearer, y de ultima', () => {
    const conBearer = candidatosDeToken(h({ authorization: 'Bearer fc_x' }), q('token=fc_y'))
    expect(conBearer.map((x) => x.origen)).toEqual(['query:token', 'authorization'])

    const sinBearer = candidatosDeToken(h({ authorization: 'fc_x' }), q())
    expect(sinBearer).toHaveLength(0)
  })

  it('descarta vacios y recorta espacios', () => {
    expect(candidatosDeToken(h({ 'x-metrik-token': '   ' }), q('token=+'))).toHaveLength(0)
    expect(candidatosDeToken(h(), q('token=%20fc_z%20'))[0].valor).toBe('fc_z')
  })

  it('acepta los alias de query', () => {
    expect(candidatosDeToken(h(), q('metrik_token=a')).map((x) => x.origen)).toEqual([
      'query:metrik_token',
    ])
  })

  it('sin nada, lista vacia', () => {
    expect(candidatosDeToken(h(), q())).toHaveLength(0)
  })
})

describe('huella', () => {
  it('es estable y no contiene el valor', async () => {
    const f = await huella('fc_secreto')
    expect(f).toBe(await huella('fc_secreto'))
    expect(f).not.toContain('fc_secreto')
    expect(f).toMatch(/^[0-9a-f]{8}\/10$/)
  })

  it('distingue un valor truncado del completo', async () => {
    expect(await huella('fc_abcdef')).not.toBe(await huella('fc_abcde'))
  })
})

describe('motivoSinToken', () => {
  it('nombra lo que si trajo la query', () => {
    expect(motivoSinToken(q('nombre=Ana&telefono=300'))).toBe(
      'sin token — la query trajo nombre, telefono, ninguno portador',
    )
  })

  it('sin query, lo dice pelado', () => {
    expect(motivoSinToken(q())).toBe('sin token')
  })
})
