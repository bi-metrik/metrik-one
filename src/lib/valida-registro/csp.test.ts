import { describe, expect, it } from 'vitest'
import { API_EPAYCO, SCRIPT_EPAYCO, SCRIPT_JQUERY, politicaRegistroValida } from './csp'

function directivas(politica: string): Map<string, string[]> {
  return new Map(
    politica.split(';').map((d) => {
      const [nombre, ...valores] = d.trim().split(/\s+/)
      return [nombre, valores] as const
    }),
  )
}

describe('CSP de /valida/empezar', () => {
  const p = directivas(politicaRegistroValida('https://yfjqscvvxetobiidnepa.supabase.co/'))

  it('solo deja cargar scripts propios, jQuery y ePayco.js, por su archivo exacto', () => {
    const externos = p.get('script-src')!.filter((v) => v.startsWith('http'))
    expect(externos).toEqual([SCRIPT_JQUERY, SCRIPT_EPAYCO])
    expect(p.get('script-src')).toContain("'self'")
    expect(p.get('script-src')).not.toContain("'unsafe-eval'")
    expect(p.get('script-src')).not.toContain('https:')
    expect(p.get('script-src')).not.toContain('*')
  })

  it('solo conecta con ONE, Supabase Auth y la API de tokenización de ePayco', () => {
    expect(p.get('connect-src')).toEqual(["'self'", API_EPAYCO, 'https://yfjqscvvxetobiidnepa.supabase.co'])
  })

  it('cae a lo propio en todo lo demás y no deja que otra página la enmarque', () => {
    expect(p.get('default-src')).toEqual(["'self'"])
    expect(p.get('frame-ancestors')).toEqual(["'none'"])
    expect(p.get('frame-src')).toEqual(["'none'"])
    expect(p.get('object-src')).toEqual(["'none'"])
    expect(p.get('form-action')).toEqual(["'self'"])
    expect(p.get('base-uri')).toEqual(["'self'"])
  })

  it('sin la URL de Supabase no inventa un origen comodín', () => {
    expect(directivas(politicaRegistroValida(undefined)).get('connect-src')).toEqual(["'self'", API_EPAYCO])
    expect(directivas(politicaRegistroValida('no-es-url')).get('connect-src')).toEqual(["'self'", API_EPAYCO])
  })

  it('en desarrollo abre eval y el websocket de recarga, y solo ahí', () => {
    const dev = directivas(politicaRegistroValida(undefined, true))
    expect(dev.get('script-src')).toContain("'unsafe-eval'")
    expect(dev.get('connect-src')).toContain('ws:')
  })
})
