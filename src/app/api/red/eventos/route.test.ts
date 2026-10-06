import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let usuario: { id: string } | null = { id: 'u-1' }
let staff: { id: string; full_name: string; workspaces: { slug: string } | null } | null = null
let ipConsultada: string | null | undefined

const pendientes: Array<() => Promise<unknown>> = []
const guardados: Array<{ ctx: unknown; n: number }> = []

vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (fn: () => Promise<unknown>) => pendientes.push(fn),
}))
vi.mock('@/lib/red/guardar-eventos', () => ({
  workspaceIdDeSlug: async (_svc: unknown, slug: string) => (slug === 'soena' ? 'ws-soena' : null),
  guardarEventosRed: async (_svc: unknown, ctx: unknown, eventos: unknown[]) => {
    guardados.push({ ctx, n: eventos.length })
    return true
  },
}))
vi.mock('@/lib/version/build', () => ({ versionDelBuild: () => 'dpl_x' }))
vi.mock('@/lib/supabase/claims-user', () => ({ usuarioDesdeToken: async () => ({ user: usuario, error: null }) }))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({}),
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: staff }) }) }),
    }),
  }),
}))
vi.mock('@/lib/red/operador', () => ({
  ipDelCliente: (h: Headers) => h.get('x-real-ip'),
  operadorDeIp: async (ip: string | null) => {
    ipConsultada = ip
    return { asn: 14080, nombre: 'Telmex Colombia S.A., CO', marca: 'Claro' }
  },
}))

const { POST } = await import('./route')

let logSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  pendientes.length = 0
  guardados.length = 0
  usuario = { id: 'u-1' }
  staff = null
  ipConsultada = undefined
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => logSpy.mockRestore())

const falla = { tipo: 'falla', id: 'f-1', t: 1_790_000_000_000, superficie: 'carga', ruta: '/negocios/[id]' }

const enviar = (slug: string | null, cuerpo: unknown = { eventos: [falla] }) =>
  POST(
    new Request('https://soena.metrikone.co/api/red/eventos', {
      method: 'POST',
      body: JSON.stringify(cuerpo),
      headers: {
        ...(slug ? { 'x-tenant-slug': slug } : {}),
        'x-real-ip': '186.81.102.19',
        'x-vercel-ip-city': 'Bogot%C3%A1',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/140',
      },
    }),
  )

function linea() {
  const llamada = logSpy.mock.calls.find((c: unknown[]) => c[0] === '[red-piloto]')
  return llamada ? JSON.parse(llamada[1] as string) : null
}

describe('POST /api/red/eventos', () => {
  it('fuera del piloto responde 204 y no registra nada', async () => {
    expect((await enviar('trappvel')).status).toBe(204)
    expect((await enviar(null)).status).toBe(204)
    expect(linea()).toBeNull()
    expect(pendientes).toHaveLength(0)
  })

  it('sin sesión: 401 (el navegador conserva el lote)', async () => {
    usuario = null
    expect((await enviar('soena')).status).toBe(401)
    expect(linea()).toBeNull()
  })

  it('persona de la lista: lleva su staff.id; operador y ciudad sin la IP', async () => {
    staff = { id: 'staff-camila', full_name: 'María Camila Garzón David', workspaces: { slug: 'soena' } }
    expect((await enviar('soena')).status).toBe(204)
    const l = linea()
    expect(l).toMatchObject({
      ws: 'soena',
      persona: 'maria camila garzon david',
      persona_id: 'staff-camila',
      operador: 'Claro',
      asn: 14080,
      ciudad: 'Bogotá',
      dispositivo: 'escritorio',
      eventos: [falla],
    })
    expect(ipConsultada).toBe('186.81.102.19')
    expect(JSON.stringify(l)).not.toContain('186.81.102.19')
    // Y la copia en `red_eventos`, después de responder.
    expect(guardados).toHaveLength(0)
    await Promise.all(pendientes.map((f) => f()))
    expect(guardados).toEqual([
      {
        ctx: expect.objectContaining({ workspaceId: 'ws-soena', personaStaffId: 'staff-camila', operador: 'Claro', asn: 14080, ciudad: 'Bogotá' }),
        n: 1,
      },
    ])
  })

  it('persona fuera de la lista o de otro workspace: sin identificador', async () => {
    staff = { id: 'staff-deisy', full_name: 'Deisy Ramirez', workspaces: { slug: 'soena' } }
    await enviar('soena')
    expect(linea()).toMatchObject({ persona: null, persona_id: null })
    logSpy.mockClear()
    staff = { id: 'staff-x', full_name: 'Jessica Tejada', workspaces: { slug: 'otro' } }
    await enviar('soena')
    expect(linea()).toMatchObject({ persona: null, persona_id: null })
  })

  it('cuerpo roto: 400', async () => {
    const res = await POST(
      new Request('https://soena.metrikone.co/api/red/eventos', {
        method: 'POST',
        body: '{',
        headers: { 'x-tenant-slug': 'soena' },
      }),
    )
    expect(res.status).toBe(400)
  })
})
