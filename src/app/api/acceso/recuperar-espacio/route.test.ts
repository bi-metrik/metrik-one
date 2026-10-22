import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * La ruta responde lo MISMO exista o no la cuenta, y también al pasar el tope. Lo de afuera (Auth, la
 * base, Resend) se reemplaza; la lógica de la ruta y de `enviarDireccionesDeEspacio` es la real.
 */

const enviados: string[] = []
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/acceso-espacio/servidor', async (original) => {
  const real = await original<typeof import('@/lib/acceso-espacio/servidor')>()
  return {
    ...real,
    depsRecuperarReales: (ahoraMs: number) => ({
      buscarUsuario: async (c: string) => (c.startsWith('existe') ? 'u-1' : null),
      espaciosDe: async () => [{ slug: 'acme', nombre: 'ACME' }],
      enviar: async (m: { to: string }) => {
        enviados.push(m.to)
        return { ok: true, id: null }
      },
      urlLogin: (s: string) => `https://${s}.metrikone.co/login`,
      ahoraMs,
    }),
  }
})

function pedir(correo: unknown, ip = '181.1.1.1') {
  return new Request('https://metrikone.co/api/acceso/recuperar-espacio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `${ip}, 76.76.21.21` },
    body: JSON.stringify({ correo }),
  })
}

describe('POST /api/acceso/recuperar-espacio', () => {
  beforeEach(() => {
    enviados.length = 0
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('con cuenta y sin cuenta responde igual; solo con cuenta sale correo', async () => {
    const { POST } = await import('./route')
    const con = await POST(pedir('existe-1@acme.example', '181.0.0.1'))
    const sin = await POST(pedir('nadie-1@acme.example', '181.0.0.2'))
    expect(con.status).toBe(200)
    expect(sin.status).toBe(200)
    expect(await con.json()).toEqual(await sin.json())
    expect(enviados).toEqual(['existe-1@acme.example'])
  })

  it('un correo mal escrito responde 422 sin buscar nada', async () => {
    const { POST } = await import('./route')
    const r = await POST(pedir('no-es-correo', '181.0.0.3'))
    expect(r.status).toBe(422)
    expect(enviados).toEqual([])
  })

  it('pasado el tope por correo responde igual, pero ya no envía', async () => {
    const { POST } = await import('./route')
    const respuestas = []
    for (let i = 0; i < 5; i++) respuestas.push(await (await POST(pedir('existe-2@acme.example', `181.0.1.${i}`))).json())
    expect(new Set(respuestas.map((r) => JSON.stringify(r))).size).toBe(1)
    expect(enviados).toHaveLength(3)
  })

  it('pasado el tope por IP responde igual, pero ya no envía', async () => {
    const { POST } = await import('./route')
    for (let i = 0; i < 12; i++) await POST(pedir(`existe-ip-${i}@acme.example`, '181.0.2.9'))
    expect(enviados).toHaveLength(10)
  })
})
