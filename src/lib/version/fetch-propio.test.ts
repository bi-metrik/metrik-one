import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPropio, idDelDeployment, sellarConDeployment } from './fetch-propio'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('sellarConDeployment', () => {
  it('agrega x-deployment-id sin pisar los headers que ya traia', () => {
    const init = sellarConDeployment(
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      'dpl_viejo',
    )!
    const h = new Headers(init.headers)
    expect(h.get('x-deployment-id')).toBe('dpl_viejo')
    expect(h.get('content-type')).toBe('application/json')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{}')
  })

  it('acepta headers como instancia de Headers', () => {
    const init = sellarConDeployment({ headers: new Headers({ accept: 'text/csv' }) }, 'dpl_x')!
    const h = new Headers(init.headers)
    expect(h.get('accept')).toBe('text/csv')
    expect(h.get('x-deployment-id')).toBe('dpl_x')
  })

  it('sin init, igual sella', () => {
    expect(new Headers(sellarConDeployment(undefined, 'dpl_x')!.headers).get('x-deployment-id')).toBe('dpl_x')
  })

  // Fuera de Vercel (dev, tests) no hay id: se manda la peticion tal cual.
  it('sin id no toca nada', () => {
    const init = { method: 'GET' }
    expect(sellarConDeployment(init, null)).toBe(init)
    expect(sellarConDeployment(undefined, null)).toBeUndefined()
  })

  // Un FormData no debe recibir content-type a mano: el navegador pone el boundary.
  it('con FormData no inventa content-type', () => {
    const fd = new FormData()
    fd.append('a', '1')
    const init = sellarConDeployment({ method: 'POST', body: fd }, 'dpl_x')!
    expect(new Headers(init.headers).has('content-type')).toBe(false)
    expect(init.body).toBe(fd)
  })
})

describe('idDelDeployment', () => {
  it('lee NEXT_DEPLOYMENT_ID (el que Next inlina desde deploymentId)', () => {
    vi.stubEnv('NEXT_DEPLOYMENT_ID', 'dpl_abc')
    expect(idDelDeployment()).toBe('dpl_abc')
  })

  it('vacio o ausente → null', () => {
    vi.stubEnv('NEXT_DEPLOYMENT_ID', '')
    expect(idDelDeployment()).toBeNull()
  })
})

describe('fetchPropio', () => {
  it('manda la peticion sellada con el deployment de la pestaña', async () => {
    vi.stubEnv('NEXT_DEPLOYMENT_ID', 'dpl_pestana')
    const falso = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', falso)
    await fetchPropio('/api/negocios/lista?x=1', { cache: 'no-store' })
    const [ruta, init] = falso.mock.calls[0] as unknown as [string, RequestInit]
    expect(ruta).toBe('/api/negocios/lista?x=1')
    expect(init.cache).toBe('no-store')
    expect(new Headers(init.headers).get('x-deployment-id')).toBe('dpl_pestana')
  })
})
