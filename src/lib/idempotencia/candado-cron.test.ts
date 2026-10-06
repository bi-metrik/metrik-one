import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { candadoDeCron } from './candado-cron'

/** Un `tomar_candado` en memoria con la misma regla que la función SQL. */
function doble(vencido = false) {
  const tomados = new Map<string, number>()
  return {
    llamadas: 0,
    rpc: async function (_fn: string, a: Record<string, unknown>) {
      this.llamadas++
      await new Promise((r) => setTimeout(r, 0))
      const k = a.p_clave as string
      const vence = tomados.get(k)
      if (vence !== undefined && vence > Date.now() && !vencido) return { data: false, error: null }
      tomados.set(k, Date.now() + (a.p_segundos as number) * 1000)
      return { data: true, error: null }
    },
  }
}

const req = (q = '', auth?: string) =>
  new Request(`https://x.metrikone.co/api/crons/c${q}`, { headers: auth ? { authorization: auth } : {} })

beforeEach(() => { process.env.CRON_SECRET = 'secreto' })
afterEach(() => { delete process.env.CRON_SECRET })

describe('candadoDeCron', () => {
  it('dos entregas A LA VEZ: corre una sola', async () => {
    const svc = doble()
    const [a, b] = await Promise.all([candadoDeCron('c', req(), { svc }), candadoDeCron('c', req(), { svc })])
    expect([a, b].filter((r) => r === null)).toHaveLength(1)
  })

  it('una segunda entrega DESPUÉS de terminar tampoco corre (el candado no se suelta)', async () => {
    const svc = doble()
    expect(await candadoDeCron('c', req(), { svc })).toBeNull()
    const segunda = await candadoDeCron('c', req(), { svc })
    expect(segunda).not.toBeNull()
    expect(await segunda!.json()).toEqual({ ok: true, omitido: 'otra_corrida_reciente', cron: 'c' })
  })

  it('crons distintos no se estorban', async () => {
    const svc = doble()
    expect(await candadoDeCron('a', req(), { svc })).toBeNull()
    expect(await candadoDeCron('b', req(), { svc })).toBeNull()
  })

  it('a mano con el secreto y ?forzar=1 corre aunque el candado esté tomado', async () => {
    const svc = doble()
    await candadoDeCron('c', req(), { svc })
    expect(await candadoDeCron('c', req('?forzar=1', 'Bearer secreto'), { svc })).toBeNull()
  })

  it('?forzar=1 SIN el secreto no salta el candado', async () => {
    const svc = doble()
    await candadoDeCron('c', req(), { svc })
    expect(await candadoDeCron('c', req('?forzar=1'), { svc })).not.toBeNull()
  })

  it('sin la función (migración sin aplicar) corre como siempre', async () => {
    const espia = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const svc = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) }
    expect(await candadoDeCron('c', req(), { svc })).toBeNull()
    espia.mockRestore()
  })
})
