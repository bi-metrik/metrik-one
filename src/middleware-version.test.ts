/**
 * `/api/version` pasa el middleware SIN resolver la sesion: es publica y la consulta
 * `VersionWatcher` cada 5 min por pestaña. Antes costaba Auth + `/profiles` por consulta.
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

describe('middleware: version del deployment', () => {
  it('en un subdominio no toca la sesion ni redirige a /login (sesion vencida)', async () => {
    const res = await middleware(get('http://soena.localhost:3000/api/version', 'soena.localhost:3000'))
    expect(updateSession).not.toHaveBeenCalled()
    expect(res.headers.get('location')).toBeNull()
  })

  it('control: otra ruta de la API del subdominio SI resuelve la sesion', async () => {
    await middleware(get('http://soena.localhost:3000/api/negocios/export', 'soena.localhost:3000'))
    expect(updateSession).toHaveBeenCalledTimes(1)
  })
})
