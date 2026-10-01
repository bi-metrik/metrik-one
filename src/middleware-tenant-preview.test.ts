/**
 * El preview de un PR abre el workspace de un cliente (brief 2026-10-01, PR 1).
 *
 * Criterio 1 (abrir el link y ver el workspace): un preview no tiene subdominio, así que el
 * inquilino lo declara `?__ws=<slug>` → cookie → la petición recorre la rama de inquilino del
 * middleware con la misma cabecera `x-tenant-slug` que pondría `trappvel.metrikone.co`.
 * Criterio 3 (producción idéntica): fuera de un preview el parámetro y la cookie se ignoran,
 * y en un subdominio real manda el subdominio.
 *
 * El host de las pruebas de inquilino es `trappvel.localhost:3000` porque en el entorno de
 * pruebas el dominio base es `localhost:3000` (mismo criterio que middleware-tenant-header).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

let usuario: { id: string } | null = { id: 'user-1' }

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (request: NextRequest) => ({
    user: usuario,
    supabaseResponse: NextResponse.next({ request }),
    supabase: {
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }),
      }),
    },
  }),
}))
vi.mock('@/lib/modulos/perfil-de-acceso', () => ({
  leerPerfilDeAcceso: async () => ({ role: 'owner', gate: null, slugWorkspace: null }),
}))
vi.mock('@/lib/modulos/gate', () => ({
  rutaGateada: () => false,
  destinoSiBloqueada: () => null,
}))

const { middleware } = await import('./middleware')

const HOST_PREVIEW = 'metrik-one-git-max-preview-metrik-one.vercel.app'

function peticion(url: string, host: string, cookie?: string) {
  const headers: Record<string, string> = { host }
  if (cookie) headers.cookie = cookie
  return new NextRequest(new URL(url), { headers })
}

function slugQueLlegaAlRender(res: NextResponse): string | null {
  return res.headers.get('x-middleware-request-x-tenant-slug')
}

afterEach(() => {
  vi.unstubAllEnvs()
  usuario = { id: 'user-1' }
})

describe('preview: ?__ws=<slug> declara el inquilino (criterio 1)', () => {
  it('fija la cookie y redirige a la misma URL sin el parámetro', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const res = await middleware(
      peticion(`https://${HOST_PREVIEW}/negocios?__ws=trappvel&x=1`, HOST_PREVIEW),
    )
    expect(res.status).toBe(307)
    const destino = new URL(res.headers.get('location')!)
    expect(destino.host).toBe(HOST_PREVIEW)
    expect(destino.pathname).toBe('/negocios')
    expect(destino.searchParams.get('__ws')).toBeNull()
    expect(destino.searchParams.get('x')).toBe('1')
    const cookie = res.cookies.get('__preview_ws')
    expect(cookie?.value).toBe('trappvel')
    expect(cookie?.httpOnly).toBe(true)
  })

  it('?__ws=off borra la cookie', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const res = await middleware(
      peticion(`https://${HOST_PREVIEW}/?__ws=off`, HOST_PREVIEW, '__preview_ws=trappvel'),
    )
    expect(res.status).toBe(307)
    expect(res.headers.get('set-cookie') ?? '').toMatch(/__preview_ws=;/)
  })

  it('con la cookie, la ruta del inquilino lleva el slug al render', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const res = await middleware(
      peticion(`https://${HOST_PREVIEW}/negocios`, HOST_PREVIEW, '__preview_ws=trappvel'),
    )
    expect(slugQueLlegaAlRender(res)).toBe('trappvel')
  })

  it('sin sesión, manda al login DEL MISMO host con la marca del cliente', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    usuario = null
    const res = await middleware(
      peticion(`https://${HOST_PREVIEW}/negocios`, HOST_PREVIEW, '__preview_ws=trappvel'),
    )
    const destino = new URL(res.headers.get('location')!)
    expect(destino.host).toBe(HOST_PREVIEW)
    expect(destino.pathname).toBe('/login')

    const login = await middleware(
      peticion(`https://${HOST_PREVIEW}/login`, HOST_PREVIEW, '__preview_ws=trappvel'),
    )
    // El login del inquilino se reescribe con ?__ws=<slug> para pintar el logo del cliente.
    const reescrita = login.headers.get('x-middleware-rewrite')
    expect(reescrita && new URL(reescrita).searchParams.get('__ws')).toBe('trappvel')
  })

  it('sin cookie, el preview sigue como antes (sin inquilino)', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const res = await middleware(peticion(`https://${HOST_PREVIEW}/negocios`, HOST_PREVIEW))
    expect(slugQueLlegaAlRender(res)).toBeNull()
  })
})

describe('producción no cambia (criterio 3)', () => {
  it('?__ws= se ignora fuera de un preview', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    const res = await middleware(
      peticion('https://trappvel.localhost:3000/negocios?__ws=soena', 'trappvel.localhost:3000'),
    )
    expect(res.cookies.get('__preview_ws')).toBeUndefined()
    expect(res.headers.get('location')).toBeNull()
    expect(slugQueLlegaAlRender(res)).toBe('trappvel')
  })

  it('la cookie se ignora fuera de un preview', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    const res = await middleware(
      peticion('https://localhost:3000/negocios', 'localhost:3000', '__preview_ws=trappvel'),
    )
    expect(slugQueLlegaAlRender(res)).toBeNull()
  })

  it('en un subdominio real manda el subdominio, aunque haya cookie', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const res = await middleware(
      peticion('https://soena.localhost:3000/negocios', 'soena.localhost:3000', '__preview_ws=trappvel'),
    )
    expect(slugQueLlegaAlRender(res)).toBe('soena')
  })
})
