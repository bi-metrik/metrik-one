import { describe, expect, it } from 'vitest'
import { drenarObjetosPurgados, type ClienteDrenaje, type ObjetoPendiente } from './drenar-objetos'
import { BUCKET_ACEPTACIONES } from './plazos'

/**
 * El cron que borra los PDF ya purgados.
 *
 * El doble guarda la cola de verdad y la vacía solo con lo que se le pide: una prueba que
 * mirara únicamente las llamadas no distinguiría "no borró la fila" de "la borró y no se ve".
 */

interface Doble {
  cliente: ClienteDrenaje
  cola: ObjetoPendiente[]
  removidos: { bucket: string; nombres: string[] }[]
}

function doble(
  filas: ObjetoPendiente[],
  opts: { errorRpc?: string; errorStorage?: string; errorCola?: string } = {},
): Doble {
  const d: Doble = { cola: [...filas], removidos: [], cliente: null as unknown as ClienteDrenaje }
  d.cliente = {
    rpc: async () =>
      opts.errorRpc ? { data: null, error: { message: opts.errorRpc } } : { data: [...d.cola], error: null },
    storage: {
      from: (bucket) => ({
        remove: async (nombres) => {
          if (opts.errorStorage) return { error: { message: opts.errorStorage } }
          d.removidos.push({ bucket, nombres })
          return { error: null }
        },
      }),
    },
    from: () => ({
      delete: () => ({
        in: async (_col, ids) => {
          if (opts.errorCola) return { error: { message: opts.errorCola } }
          d.cola = d.cola.filter((f) => !ids.includes(f.id))
          return { error: null }
        },
      }),
    }),
  }
  return d
}

describe('drenarObjetosPurgados', () => {
  it('borra de Storage lo pendiente y vacía la cola', async () => {
    const d = doble([
      { id: 'a', bucket: BUCKET_ACEPTACIONES, ruta: 'cliente/terminos%20v1.pdf' },
      { id: 'b', bucket: BUCKET_ACEPTACIONES, ruta: 'cliente/anexo.pdf' },
    ])
    const r = await drenarObjetosPurgados(d.cliente)
    expect(r).toEqual({ ok: true, borrados: 2, ignorados: 0 })
    // La ruta sale de una URL firmada: Storage recibe el nombre decodificado.
    expect(d.removidos).toEqual([
      { bucket: BUCKET_ACEPTACIONES, nombres: ['cliente/terminos v1.pdf', 'cliente/anexo.pdf'] },
    ])
    expect(d.cola).toEqual([])
  })

  it('nunca borra de un bucket que no es de la purga, aunque la cola lo diga', async () => {
    const d = doble([
      { id: 'a', bucket: 'workspace-logos', ruta: 'ws/logo.png' },
      { id: 'b', bucket: BUCKET_ACEPTACIONES, ruta: 'cliente/terminos.pdf' },
    ])
    const r = await drenarObjetosPurgados(d.cliente)
    expect(r).toEqual({ ok: true, borrados: 1, ignorados: 1 })
    expect(d.removidos.map((x) => x.bucket)).toEqual([BUCKET_ACEPTACIONES])
    expect(d.cola.map((f) => f.id)).toEqual(['a'])
  })

  it('una ruta que no se puede decodificar se queda en la cola', async () => {
    const d = doble([{ id: 'a', bucket: BUCKET_ACEPTACIONES, ruta: 'cliente/%E0%A4%A.pdf' }])
    const r = await drenarObjetosPurgados(d.cliente)
    expect(r).toEqual({ ok: true, borrados: 0, ignorados: 1 })
    expect(d.removidos).toEqual([])
    expect(d.cola).toHaveLength(1)
  })

  it('si Storage falla, la cola NO se toca: la ruta se reintenta mañana', async () => {
    const d = doble([{ id: 'a', bucket: BUCKET_ACEPTACIONES, ruta: 'cliente/terminos.pdf' }], {
      errorStorage: 'timeout',
    })
    const r = await drenarObjetosPurgados(d.cliente)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('timeout')
    expect(d.cola).toHaveLength(1)
  })

  it('si la RPC falla, no borra nada', async () => {
    const d = doble([{ id: 'a', bucket: BUCKET_ACEPTACIONES, ruta: 'cliente/terminos.pdf' }], {
      errorRpc: 'permission denied',
    })
    const r = await drenarObjetosPurgados(d.cliente)
    expect(r).toEqual({ ok: false, borrados: 0, ignorados: 0, error: 'permission denied' })
    expect(d.removidos).toEqual([])
  })

  it('cola vacía: no llama a Storage', async () => {
    const d = doble([])
    expect(await drenarObjetosPurgados(d.cliente)).toEqual({ ok: true, borrados: 0, ignorados: 0 })
    expect(d.removidos).toEqual([])
  })
})
