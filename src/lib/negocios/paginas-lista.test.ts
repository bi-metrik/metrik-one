import { afterEach, describe, expect, it, vi } from 'vitest'
import { pedirJson, pegarPagina, refrescarComienzo } from './paginas-lista'

const t = (id: string) => ({ id })
const ids = (xs: { id: string }[]) => xs.map((x) => x.id)

describe('pegarPagina', () => {
  it('pega la página detrás de lo que ya había', () => {
    expect(ids(pegarPagina([t('a'), t('b')], 2, [t('c'), t('d')]))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('no repite una tarjeta que ya estaba (la lista se movió entre páginas)', () => {
    expect(ids(pegarPagina([t('a'), t('b')], 2, [t('b'), t('c')]))).toEqual(['a', 'b', 'c'])
  })

  it('tampoco repite dentro de la misma página', () => {
    expect(ids(pegarPagina([t('a')], 1, [t('c'), t('c')]))).toEqual(['a', 'c'])
  })

  it('corta en `desde`: lo que había después se reemplaza por la página', () => {
    expect(ids(pegarPagina([t('a'), t('b'), t('x')], 2, [t('c')]))).toEqual(['a', 'b', 'c'])
  })
})

describe('refrescarComienzo', () => {
  it('reemplaza el comienzo y conserva la cola, sin encoger la lista', () => {
    const r = refrescarComienzo([t('a'), t('b'), t('c'), t('d')], [t('a2'), t('b2')])
    expect(ids(r)).toEqual(['a2', 'b2', 'c', 'd'])
  })

  it('una tarjeta que subió al comienzo no queda también en la cola', () => {
    const r = refrescarComienzo([t('a'), t('b'), t('c'), t('d')], [t('d'), t('a')])
    expect(ids(r)).toEqual(['d', 'a', 'c'])
  })
})

describe('pedirJson', () => {
  const ac = new AbortController()
  afterEach(() => vi.unstubAllGlobals())

  const responder = (r: Partial<Response> & { cuerpo?: unknown; tipo?: string }) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: (r.status ?? 200) < 400,
        status: r.status ?? 200,
        redirected: r.redirected ?? false,
        headers: new Headers({ 'content-type': r.tipo ?? 'application/json' }),
        json: async () => r.cuerpo,
      })),
    )

  /** La promesa no se resuelve (la página se va): se compara contra un testigo. */
  async function quedaColgada(p: Promise<unknown>) {
    const testigo = Symbol('colgada')
    const r = await Promise.race([p, new Promise((res) => setTimeout(() => res(testigo), 20))])
    return r === testigo
  }

  it('JSON con 200: lo devuelve', async () => {
    responder({ cuerpo: { ids: ['a'] } })
    await expect(pedirJson('/api/negocios/lista', ac.signal, vi.fn())).resolves.toEqual({ ids: ['a'] })
  })

  it('401 (dominio base, sesión vencida): recarga la página y no revienta', async () => {
    responder({ status: 401, cuerpo: { error: 'No autenticado' } })
    const recargar = vi.fn()
    expect(await quedaColgada(pedirJson('/api/negocios/lista', ac.signal, recargar))).toBe(true)
    expect(recargar).toHaveBeenCalledTimes(1)
  })

  it('redirect del middleware a /login: recarga la página', async () => {
    responder({ redirected: true, tipo: 'text/html', cuerpo: undefined })
    const recargar = vi.fn()
    expect(await quedaColgada(pedirJson('/api/negocios/lista', ac.signal, recargar))).toBe(true)
    expect(recargar).toHaveBeenCalledTimes(1)
  })

  it('200 que no es JSON (una página HTML): recarga la página', async () => {
    responder({ tipo: 'text/html; charset=utf-8' })
    const recargar = vi.fn()
    expect(await quedaColgada(pedirJson('/api/negocios/lista', ac.signal, recargar))).toBe(true)
    expect(recargar).toHaveBeenCalledTimes(1)
  })

  it('500: lanza (la pantalla conserva la lista y ofrece reintentar), sin recargar', async () => {
    responder({ status: 500, cuerpo: { error: 'No se pudo leer la lista' } })
    const recargar = vi.fn()
    await expect(pedirJson('/api/negocios/lista', ac.signal, recargar)).rejects.toThrow('HTTP 500')
    expect(recargar).not.toHaveBeenCalled()
  })
})
