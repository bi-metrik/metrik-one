/**
 * `/api/errores-cliente` pasa el middleware SIN sesion: `global-error` puede saltar con la
 * sesion vencida, y un 307 a /login perderia el reporte.
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

const post = (url: string, host: string) =>
  new NextRequest(new URL(url), { method: 'POST', headers: { host } })

describe('middleware: reporte de errores del navegador', () => {
  it('en un subdominio sin sesion no redirige a /login ni toca la sesion', async () => {
    const res = await middleware(
      post('http://soena.localhost:3000/api/errores-cliente', 'soena.localhost:3000'),
    )
    expect(res.status).not.toBe(307)
    expect(res.headers.get('location')).toBeNull()
    expect(updateSession).not.toHaveBeenCalled()
  })

  it('en el dominio de marketing tampoco', async () => {
    const res = await middleware(post('http://localhost:3000/api/errores-cliente', 'localhost:3000'))
    expect(res.headers.get('location')).toBeNull()
  })

  it('control: otra ruta del subdominio sin sesion SI va a /login', async () => {
    const res = await middleware(
      new NextRequest(new URL('http://soena.localhost:3000/negocios'), { headers: { host: 'soena.localhost:3000' } }),
    )
    expect(res.headers.get('location')).toContain('/login')
  })
})
