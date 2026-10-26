import { describe, it, expect, vi, beforeEach } from 'vitest'

const { resolver } = vi.hoisted(() => ({ resolver: vi.fn() }))
vi.mock('@/lib/actions/formulario-actions', () => ({ resolverFormularioParaEdicion: resolver }))

const { GET } = await import('./route')

const NEGOCIO = '11111111-1111-4111-8111-111111111111'
const BLOQUE = '22222222-2222-4222-8222-222222222222'

const pedir = (id = NEGOCIO, bloqueId = BLOQUE) =>
  GET(new Request(`http://soena.localhost:3000/api/negocios/${id}/formulario/${bloqueId}`), {
    params: Promise.resolve({ id, bloqueId }),
  })

beforeEach(() => {
  resolver.mockReset().mockResolvedValue({
    casillas: [{ slug: 'c5', value: '900123456' }],
    versiones: [],
    confirmacion_nit: { requerida: true, confirmada: false },
  })
})

describe('GET /api/negocios/[id]/formulario/[bloqueId]', () => {
  it('200 con lo mismo que devuelve la action, sin cache', async () => {
    const res = await pedir()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ casillas: [{ slug: 'c5' }], versiones: [] })
    // Argumentos en el orden de la action: (bloque, negocio).
    expect(resolver).toHaveBeenCalledWith(BLOQUE, NEGOCIO)
  })

  it('sin sesion: 401', async () => {
    resolver.mockResolvedValue({ casillas: [], versiones: [], error: 'No autenticado' })
    expect((await pedir()).status).toBe(401)
  })

  it('bloque que no existe (o de otro workspace, que el RLS no deja ver): 200 con el error, como la action', async () => {
    resolver.mockResolvedValue({ casillas: [], versiones: [], error: 'Bloque no encontrado' })
    const res = await pedir()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ error: 'Bloque no encontrado', casillas: [] })
  })

  it('ids que no son UUID: 400 sin llamar a la base', async () => {
    expect((await pedir('abc', BLOQUE)).status).toBe(400)
    expect((await pedir(NEGOCIO, '../x')).status).toBe(400)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('si la lectura revienta: 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    resolver.mockRejectedValue(new Error('boom'))
    expect((await pedir()).status).toBe(500)
  })
})
