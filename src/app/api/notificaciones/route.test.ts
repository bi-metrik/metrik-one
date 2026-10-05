import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { getWorkspace, getNotificaciones } = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  getNotificaciones: vi.fn(),
}))
vi.mock('@/lib/actions/get-workspace', () => ({ getWorkspace }))
vi.mock('@/lib/actions/notificaciones', () => ({ getNotificaciones }))

const { GET } = await import('./route')

const PAGINA = {
  items: [{ id: 'n1', tipo: 'mencion', estado: 'pendiente', contenido: 'Hola', created_at: '2026-10-05T10:00:00Z' }],
  total: 1,
}

const pedir = (query = '', headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://soena.localhost:3000/api/notificaciones${query}`, { headers }))

beforeEach(() => {
  getWorkspace.mockReset().mockResolvedValue({ userId: 'u-1', workspaceId: 'ws-1', error: null })
  getNotificaciones.mockReset().mockResolvedValue(PAGINA)
})

describe('GET /api/notificaciones', () => {
  it('200 con la pagina, ETag y Cache-Control private, no-cache', async () => {
    const res = await pedir()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(PAGINA)
    expect(res.headers.get('etag')).toMatch(/^".+"$/)
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
    expect(getNotificaciones).toHaveBeenCalledWith(0)
  })

  it('304 sin cuerpo si el navegador ya tiene esa respuesta (tambien con ETag debil)', async () => {
    const etag = (await pedir()).headers.get('etag') as string
    const res = await pedir('', { 'if-none-match': etag })
    expect(res.status).toBe(304)
    expect(await res.text()).toBe('')
    expect(res.headers.get('etag')).toBe(etag)
    expect(res.headers.get('cache-control')).toBe('private, no-cache')
    expect((await pedir('', { 'if-none-match': `W/${etag}` })).status).toBe(304)
  })

  it('si cambio algo, 200 con el ETag nuevo', async () => {
    const etag = (await pedir()).headers.get('etag') as string
    getNotificaciones.mockResolvedValue({ items: [], total: 0 })
    const res = await pedir('', { 'if-none-match': etag })
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).not.toBe(etag)
  })

  it('sin sesion: 401 y no lee nada', async () => {
    getWorkspace.mockResolvedValue({ userId: null, workspaceId: null, error: 'No autenticado' })
    const res = await pedir()
    expect(res.status).toBe(401)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(getNotificaciones).not.toHaveBeenCalled()
  })

  it('el alcance es el de la sesion: un usuario en la query no cambia nada', async () => {
    await pedir('?desde=50&userId=otro&destinatario_id=otro')
    expect(getNotificaciones).toHaveBeenCalledWith(50)
    expect(getNotificaciones.mock.calls[0]).toHaveLength(1)
  })

  it('desde invalido cae a 0; uno enorme se acota', async () => {
    await pedir('?desde=-3')
    await pedir('?desde=abc')
    await pedir('?desde=999999')
    expect(getNotificaciones.mock.calls.map((c) => c[0])).toEqual([0, 0, 10_000])
  })

  it('si la lectura revienta: 500 sin cache', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    getNotificaciones.mockRejectedValue(new Error('timeout'))
    const res = await pedir()
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
