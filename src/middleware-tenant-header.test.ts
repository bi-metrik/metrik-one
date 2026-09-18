/**
 * El slug del inquilino viaja en las cabeceras de REQUEST, no solo en la respuesta.
 *
 * La distinción es el defecto entero: `supabaseResponse.headers.set('x-tenant-slug', …)`
 * se lee igual de bien en una revisión de código y el server component NUNCA lo ve, así
 * que el workspace se resolvía siempre desde `profiles.workspace_id` y una pestaña vieja
 * seguía escribiendo en el inquilino equivocado.
 *
 * Se afirma sobre `x-middleware-request-x-tenant-slug`, que es la cabecera con la que
 * Next transporta un override de request hacia el render. Una cabecera puesta solo en la
 * respuesta no produce esa marca: por eso la prueba distingue las dos cosas y no se
 * conforma con ver el slug en algún lado.
 *
 * VISTAS FALLAR (2026-09-18) contra el código anterior: las dos de rutas de inquilino.
 */
import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (request: NextRequest) => ({
    user: { id: 'user-1' },
    supabaseResponse: NextResponse.next({ request }),
    supabase: {
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }),
      }),
    },
  }),
}))

// El gate por módulo y el guard del contador no son lo que se está probando; sin estos
// dobles, la ruta autenticada iría a la base.
vi.mock('@/lib/modulos/perfil-de-acceso', () => ({
  leerPerfilDeAcceso: async () => ({ role: 'owner', gate: null }),
}))
vi.mock('@/lib/modulos/gate', () => ({
  rutaGateada: () => false,
  destinoSiBloqueada: () => null,
}))

const { middleware } = await import('./middleware')

function peticion(url: string, host: string) {
  return new NextRequest(new URL(url), { headers: { host } })
}

/** El slug que el render va a ver en `headers().get('x-tenant-slug')`. */
function slugQueLlegaAlRender(res: NextResponse): string | null {
  return res.headers.get('x-middleware-request-x-tenant-slug')
}

describe('middleware: el subdominio llega al servidor', () => {
  it('ruta autenticada del inquilino: el slug viaja como cabecera de request', async () => {
    const res = await middleware(
      peticion('http://soena.localhost:3000/negocios', 'soena.localhost:3000'),
    )
    expect(slugQueLlegaAlRender(res)).toBe('soena')
  })

  it('ruta pública del inquilino (sin sesión de por medio) también lo lleva', async () => {
    const res = await middleware(
      peticion('http://soena.localhost:3000/cert/abc', 'soena.localhost:3000'),
    )
    expect(slugQueLlegaAlRender(res)).toBe('soena')
  })

  it('el dominio de marketing no inyecta ningún inquilino', async () => {
    const res = await middleware(peticion('http://localhost:3000/negocios', 'localhost:3000'))
    expect(slugQueLlegaAlRender(res)).toBeNull()
  })
})
