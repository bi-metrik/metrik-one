/**
 * `/sw.js` (service worker del piloto de red) pasa el middleware SIN sesion: el navegador
 * rechaza registrar o ACTUALIZAR un SW que redirige, y por la actualizacion llega el apagado.
 */
import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { updateSession } = vi.hoisted(() => ({
  updateSession: vi.fn(async (request: NextRequest) => ({
    user: null,
    supabaseResponse: NextResponse.next({ request }),
    supabase: {},
  })),
}))
vi.mock('@/lib/supabase/middleware', () => ({ updateSession }))

const { middleware } = await import('./middleware')

const get = (url: string, host: string) => new NextRequest(new URL(url), { headers: { host } })

describe('middleware: service worker del piloto', () => {
  it('en un subdominio no toca la sesion ni redirige a /login (sesion vencida)', async () => {
    const res = await middleware(get('http://soena.localhost:3000/sw.js', 'soena.localhost:3000'))
    expect(updateSession).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBeNull()
  })

  it('control: otro .js del subdominio SI resuelve la sesion', async () => {
    await middleware(get('http://soena.localhost:3000/otro.js', 'soena.localhost:3000'))
    expect(updateSession).toHaveBeenCalledTimes(1)
  })
})
