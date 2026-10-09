/**
 * Motor del cargue masivo de Valida (`cargue-lote.ts`).
 *
 * Fija: una fila que no responde se corta por tiempo y NO se reintenta; una fila con error de
 * red se reintenta una vez y el reintento lo sabe; una fila con error que no es de red no se
 * reintenta; y el lote TERMINA aunque fallen filas, con el contador correcto y los resultados
 * en el orden de entrada aunque lleguen desordenados.
 */
import { describe, it, expect, vi } from 'vitest'
import { correrFilaTolerante, procesarEnParalelo, conTiempoMaximo, TiempoAgotadoError } from './cargue-lote'

const sinPausa = async () => {}
const nunca = () => new Promise<never>(() => {})

describe('correrFilaTolerante', () => {
  it('una fila que no responde queda en error por tiempo, sin reintento', async () => {
    const intentar = vi.fn((_reintento: boolean) => nunca())
    const r = await correrFilaTolerante(intentar, 'error', { timeoutMs: 20, dormir: sinPausa })
    expect(r).toBe('error')
    expect(intentar).toHaveBeenCalledTimes(1)
  })

  it('un error de red se reintenta una vez, y el reintento va marcado', async () => {
    const intentar = vi
      .fn<(reintento: boolean) => Promise<string>>()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce('bajo')
    const r = await correrFilaTolerante(intentar, 'error', { dormir: sinPausa })
    expect(r).toBe('bajo')
    expect(intentar.mock.calls).toEqual([[false], [true]])
  })

  it('si el reintento por red tambien falla, la fila queda en error (no lanza)', async () => {
    const intentar = vi.fn(async (_r: boolean) => {
      throw new TypeError('Failed to fetch')
    })
    const r = await correrFilaTolerante(intentar, 'error', { dormir: sinPausa })
    expect(r).toBe('error')
    expect(intentar).toHaveBeenCalledTimes(2)
  })

  it('un error que no es de red no se reintenta', async () => {
    const intentar = vi.fn(async (_r: boolean) => {
      throw new Error('Negocio no encontrado')
    })
    const r = await correrFilaTolerante(intentar, 'error', { dormir: sinPausa })
    expect(r).toBe('error')
    expect(intentar).toHaveBeenCalledTimes(1)
  })

  it('una respuesta a tiempo pasa tal cual', async () => {
    const r = await correrFilaTolerante(async () => 'alto', 'error', { timeoutMs: 1000 })
    expect(r).toBe('alto')
  })
})

describe('conTiempoMaximo', () => {
  it('rechaza con TiempoAgotadoError, que no es error de red', async () => {
    await expect(conTiempoMaximo(nunca(), 10)).rejects.toBeInstanceOf(TiempoAgotadoError)
  })
})

describe('procesarEnParalelo', () => {
  it('el lote termina aunque fallen filas, con el contador y el orden correctos', async () => {
    const filas = ['ok-lenta', 'lanza', 'ok-rapida', 'red', 'cuelga', 'ok']
    const progreso: number[] = []
    const vistos: string[] = []

    const resultados = await procesarEnParalelo(
      filas,
      (fila) => {
        if (fila === 'lanza') return Promise.reject(new Error('boom fuera del tolerante'))
        return correrFilaTolerante<string>(
          async (reintento) => {
            if (fila === 'ok-lenta') await new Promise((r) => setTimeout(r, 30))
            if (fila === 'red' && !reintento) throw new TypeError('Load failed')
            if (fila === 'cuelga') return nunca()
            return `sev:${fila}`
          },
          'error',
          { timeoutMs: 50, dormir: sinPausa },
        )
      },
      {
        concurrencia: 3,
        valorDeError: 'error',
        alTerminarItem: (r, terminados) => {
          progreso.push(terminados)
          vistos.push(r)
        },
      },
    )

    expect(resultados).toEqual(['sev:ok-lenta', 'error', 'sev:ok-rapida', 'sev:red', 'error', 'sev:ok'])
    expect(progreso).toEqual([1, 2, 3, 4, 5, 6])
    expect(vistos.filter((v) => v === 'error')).toHaveLength(2)
    // Llegaron desordenadas: la lenta (indice 0) no fue la primera en terminar.
    expect(vistos[0]).not.toBe('sev:ok-lenta')
  })

  it('nunca tiene mas filas en vuelo que la concurrencia', async () => {
    let enVuelo = 0
    let maximo = 0
    await procesarEnParalelo(
      Array.from({ length: 10 }, (_, i) => i),
      async () => {
        enVuelo += 1
        maximo = Math.max(maximo, enVuelo)
        await new Promise((r) => setTimeout(r, 5))
        enVuelo -= 1
        return 'ok'
      },
      { concurrencia: 3, valorDeError: 'error' },
    )
    expect(maximo).toBe(3)
  })

  it('detenerSi: con el primer corte no arranca ninguna fila mas; las que estaban en vuelo terminan', async () => {
    const llamadas: number[] = []
    const progreso: number[] = []
    const resultados = await procesarEnParalelo(
      Array.from({ length: 10 }, (_, i) => i),
      async (i) => {
        llamadas.push(i)
        // La fila 3 agota la bolsa; la 4 ya estaba en vuelo y responde lo mismo, mas tarde.
        await new Promise((r) => setTimeout(r, i === 4 ? 15 : 5))
        return i >= 3 ? 'bolsa_agotada' : 'ok'
      },
      {
        concurrencia: 2,
        valorDeError: 'error',
        valorNoIniciado: 'no_iniciada',
        detenerSi: (r) => r === 'bolsa_agotada',
        alTerminarItem: (_, terminados) => progreso.push(terminados),
      },
    )
    expect(llamadas).toEqual([0, 1, 2, 3, 4])
    expect(resultados.slice(0, 5)).toEqual(['ok', 'ok', 'ok', 'bolsa_agotada', 'bolsa_agotada'])
    expect(resultados.slice(5)).toEqual(Array(5).fill('no_iniciada'))
    // El contador solo cuenta las que corrieron.
    expect(progreso).toEqual([1, 2, 3, 4, 5])
  })

  it('sin detenerSi, un resultado cualquiera no corta el lote', async () => {
    const resultados = await procesarEnParalelo(['a', 'b', 'c'], async (x) => `r:${x}`, { valorDeError: 'error' })
    expect(resultados).toEqual(['r:a', 'r:b', 'r:c'])
  })

  it('un lote vacio termina sin llamar a nada', async () => {
    const procesar = vi.fn(async () => 'ok')
    await expect(procesarEnParalelo([], procesar, { valorDeError: 'error' })).resolves.toEqual([])
    expect(procesar).not.toHaveBeenCalled()
  })
})
