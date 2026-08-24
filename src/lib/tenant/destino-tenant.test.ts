import { describe, it, expect } from 'vitest'
import { destinoTrasAutenticar, hostEsDelDominioBase, esRelativo } from './destino-tenant'

const PROD = { baseDomain: 'metrikone.co', isDev: false }
const PREVIEW_HOST = 'metrik-one-git-feat-graficos-abren-negocios-metrik-one.vercel.app'

describe('hostEsDelDominioBase', () => {
  it('reconoce el dominio pelado y sus subdominios', () => {
    expect(hostEsDelDominioBase('metrikone.co', 'metrikone.co')).toBe(true)
    expect(hostEsDelDominioBase('soena.metrikone.co', 'metrikone.co')).toBe(true)
  })

  it('NO reconoce un host de preview', () => {
    expect(hostEsDelDominioBase(PREVIEW_HOST, 'metrikone.co')).toBe(false)
  })

  it('no confunde un dominio que solo TERMINA parecido', () => {
    // 'notmetrikone.co'.endsWith('metrikone.co') es true — por eso se exige el punto
    expect(hostEsDelDominioBase('notmetrikone.co', 'metrikone.co')).toBe(false)
  })

  it('tolera el salto de linea pegado a la env var', () => {
    expect(hostEsDelDominioBase('soena.metrikone.co', 'metrikone.co\n')).toBe(true)
  })

  it('sin host, no pertenece', () => {
    expect(hostEsDelDominioBase(null, 'metrikone.co')).toBe(false)
    expect(hostEsDelDominioBase(undefined, 'metrikone.co')).toBe(false)
  })
})

describe('destinoTrasAutenticar', () => {
  it('en produccion manda al subdominio del tenant', () => {
    expect(destinoTrasAutenticar('soena', '/numeros', 'metrikone.co', PROD))
      .toBe('https://soena.metrikone.co/numeros')
  })

  it('desde otro subdominio tambien manda al del tenant (caso platform_admin)', () => {
    expect(destinoTrasAutenticar('soena', '/numeros', 'metrik.metrikone.co', PROD))
      .toBe('https://soena.metrikone.co/numeros')
  })

  it('⚠️ en un PREVIEW se queda en el mismo host', () => {
    const d = destinoTrasAutenticar('soena', '/numeros', PREVIEW_HOST, PROD)
    expect(d).toBe('/numeros')
    expect(esRelativo(d)).toBe(true)
  })

  it('⚠️ en un preview SIN NEXT_PUBLIC_BASE_DOMAIN no arma el host muerto', () => {
    // Estado real del scope Preview antes del arreglo: la env var no existia y
    // BASE_DOMAIN caia a 'localhost:3000' -> 'https://soena.localhost:3000/numeros'
    const d = destinoTrasAutenticar('soena', '/numeros', PREVIEW_HOST, {
      baseDomain: 'localhost:3000',
      isDev: false,
    })
    expect(d).toBe('/numeros')
    expect(d).not.toContain('localhost')
  })

  it('en local se queda en el mismo host', () => {
    expect(destinoTrasAutenticar('soena', '/numeros', 'localhost:3000', { baseDomain: 'localhost:3000', isDev: true }))
      .toBe('/numeros')
  })

  it('conserva la ruta pedida, no solo el landing', () => {
    expect(destinoTrasAutenticar('soena', '/negocios/abc?tab=cobros', 'metrikone.co', PROD))
      .toBe('https://soena.metrikone.co/negocios/abc?tab=cobros')
    expect(destinoTrasAutenticar('soena', '/negocios/abc?tab=cobros', PREVIEW_HOST, PROD))
      .toBe('/negocios/abc?tab=cobros')
  })

  it('sin host de peticion no inventa subdominio', () => {
    expect(destinoTrasAutenticar('soena', '/numeros', null, PROD)).toBe('/numeros')
  })
})
