import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/version/build', () => ({ versionDelBuild: () => 'dpl_servidor' }))
vi.mock('@/lib/tenant/extract-slug', () => ({
  extractSlug: (host: string) => (host.startsWith('soena.') ? 'soena' : null),
}))

const { POST } = await import('./route')
const { MAX_BYTES_RUM } = await import('@/lib/rum/limites')

let logSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => logSpy.mockRestore())

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148'

const enviar = (cuerpo: string, headers: Record<string, string> = {}) =>
  POST(
    new Request('http://soena.localhost:3000/api/rum', {
      method: 'POST',
      body: cuerpo,
      headers: { host: 'soena.metrikone.co', 'user-agent': IPHONE, ...headers },
    }),
  )

const base = {
  v: 1,
  carga: 'b3c1a2d4-0000-4000-8000-000000000001',
  ciclo: 1,
  entrada: '/negocios',
  ruta: '/negocios/[id]',
  version: 'dpl_viejo',
  enLinea: true,
  segDesdeCarga: 42.5,
  red: { tipo: '4g', rtt: 150, bajadaMbps: 2.3 },
  vitales: [{ n: 'LCP', v: 2400, r: 'good', ruta: '/negocios' }],
  navs: [{ de: '/negocios', a: '/negocios/[id]', ms: 1800, tipo: 'tarjeta' }],
}

const lineaRegistrada = () => {
  expect(logSpy).toHaveBeenCalledTimes(1)
  const [etiqueta, linea] = logSpy.mock.calls[0]
  expect(etiqueta).toBe('[rum]')
  return JSON.parse(linea as string)
}

describe('POST /api/rum', () => {
  it('deja UNA linea [rum] con workspace del host y dispositivo, y responde 204', async () => {
    const res = await enviar(JSON.stringify(base))
    expect(res.status).toBe(204)
    expect(lineaRegistrada()).toMatchObject({
      ...base,
      ws: 'soena',
      dispositivo: 'movil',
      versionServidor: 'dpl_servidor',
    })
  })

  it('el workspace NUNCA sale del cuerpo: un `ws` mandado por el navegador se descarta', async () => {
    await enviar(JSON.stringify({ ...base, ws: 'otro', email: 'a@b.co', userId: 'u-1' }))
    const linea = lineaRegistrada()
    expect(linea.ws).toBe('soena')
    expect(linea).not.toHaveProperty('email')
    expect(linea).not.toHaveProperty('userId')
    expect(JSON.stringify(linea)).not.toContain(IPHONE)
  })

  it('vuelve a normalizar las rutas: ids y query string no llegan al log', async () => {
    await enviar(
      JSON.stringify({
        ...base,
        ruta: '/negocios/7f3c2a10-1b2c-4d5e-8f90-123456789abc?tab=pagos',
        navs: [{ de: '/negocios?q=Maria', a: '/directorio/contacto/123', ms: 900, tipo: 'enlace' }],
      }),
    )
    const linea = lineaRegistrada()
    expect(linea.ruta).toBe('/negocios/[id]')
    expect(linea.navs[0]).toMatchObject({ de: '/negocios', a: '/directorio/contacto/[id]' })
  })

  it('una red rara no tumba el beacon: se descarta solo la red', async () => {
    const res = await enviar(JSON.stringify({ ...base, red: { tipo: 5, rtt: 'mucho' } }))
    expect(res.status).toBe(204)
    expect(lineaRegistrada()).not.toHaveProperty('red')
  })

  it('cuerpo invalido: 400 y nada en el log', async () => {
    for (const malo of [
      'no es json',
      JSON.stringify({ ...base, v: 2 }),
      JSON.stringify({ ...base, carga: 'a@b.co' }),
      JSON.stringify({ ...base, vitales: [{ n: 'FID', v: 1, ruta: '/' }] }),
      JSON.stringify({ ...base, navs: [{ ...base.navs[0], ms: -1 }] }),
      JSON.stringify({ ...base, vitales: [], navs: [] }),
    ]) {
      expect((await enviar(malo)).status).toBe(400)
    }
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('cuerpo grande: 413 por tamano real y por cabecera, sin leerlo', async () => {
    const grande = JSON.stringify({ ...base, version: 'x'.repeat(MAX_BYTES_RUM) })
    expect((await enviar(grande)).status).toBe(413)
    expect((await enviar(JSON.stringify(base), { 'content-length': String(MAX_BYTES_RUM + 1) })).status).toBe(413)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('en el dominio base no hay workspace; un computador es escritorio', async () => {
    const res = await POST(
      new Request('http://localhost:3000/api/rum', {
        method: 'POST',
        body: JSON.stringify(base),
        headers: { host: 'metrikone.co', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      }),
    )
    expect(res.status).toBe(204)
    expect(lineaRegistrada()).toMatchObject({ ws: null, dispositivo: 'escritorio' })
  })
})
