/**
 * `accionIdempotente`: la misma intención dos veces —seguidas o a la vez— ejecuta UNA.
 *
 * El doble de la tabla aplica la llave primaria (23505 al repetir), los filtros `.eq()` y las
 * actualizaciones, y cada operación cede el turno (`await`), así que dos llamadas a la vez se
 * intercalan como dos peticiones reales.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => { throw new Error('usar el doble') } }))
vi.mock('@/lib/actions/get-workspace', () => ({ getWorkspace: async () => ({ userId: 'u-1', workspaceId: 'ws-1' }) }))

const { accionIdempotente, claveEfectiva } = await import('./accion')

type Fila = Record<string, unknown>
let filas: Map<string, Fila>
let sinTabla = false

const ceder = () => new Promise<void>((r) => setTimeout(r, 0))

function doble() {
  return {
    from: () => {
      const filtros: Array<[string, unknown]> = []
      let op: 'select' | 'update' | 'delete' = 'select'
      let payload: Fila = {}
      const coinciden = () => [...filas.values()].filter((f) => filtros.every(([c, v]) => f[c] === v))
      const correr = async () => {
        await ceder()
        if (op === 'update') {
          const fs = coinciden()
          for (const f of fs) Object.assign(f, payload)
          return { data: fs.map((f) => ({ clave: f.clave })), error: null }
        }
        if (op === 'delete') {
          for (const f of coinciden()) filas.delete(f.clave as string)
          return { data: null, error: null }
        }
        return { data: coinciden().map((f) => ({ ...f })), error: null }
      }
      const q: Record<string, unknown> = {
        insert: async (f: Fila) => {
          await ceder()
          if (sinTabla) return { error: { code: 'PGRST205', message: "Could not find the table 'public.claves_idempotencia'" } }
          if (filas.has(f.clave as string)) return { error: { code: '23505', message: 'duplicate key' } }
          filas.set(f.clave as string, { ...f, creada_at: new Date().toISOString() })
          return { error: null }
        },
        select: () => q,
        update: (p: Fila) => { op = 'update'; payload = p; return q },
        delete: () => { op = 'delete'; return q },
        eq: (c: string, v: unknown) => { filtros.push([c, v]); return q },
        maybeSingle: async () => { const r = await correr(); return { data: (r.data as Fila[])[0] ?? null, error: null } },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => correr().then(res, rej),
      }
      return q
    },
  }
}

const CLAVE = '6f1d2c3b-aaaa-4bbb-8ccc-123456789abc'
const persona = { usuarioId: 'u-1', workspaceId: 'ws-1' }
const enCurso = () => ({ error: 'en curso' })

function opciones(extra: Partial<Parameters<typeof accionIdempotente>[0]> = {}) {
  return { accion: 'pagar', clave: CLAVE, args: ['neg-1', 100], enCurso, svc: doble(), persona, dormir: async () => { await ceder() }, ...extra }
}

beforeEach(() => {
  filas = new Map()
  sinTabla = false
})

describe('accionIdempotente', () => {
  it('dos veces SEGUIDAS: ejecuta una y la segunda recibe el mismo resultado', async () => {
    const fn = vi.fn(async () => ({ ok: true, id: 'cobro-1' }))
    const a = await accionIdempotente(opciones(), fn)
    const b = await accionIdempotente(opciones(), fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(b).toEqual(a)
  })

  it('dos veces A LA VEZ: ejecuta una y las dos reciben su resultado', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      for (let i = 0; i < 5; i++) await ceder()
      return { ok: true, id: `cobro-${++n}` }
    })
    const [a, b] = await Promise.all([accionIdempotente(opciones(), fn), accionIdempotente(opciones(), fn)])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(a).toEqual({ ok: true, id: 'cobro-1' })
    expect(b).toEqual({ ok: true, id: 'cobro-1' })
  })

  it('si la primera no termina a tiempo, la segunda avisa «en curso» y NO ejecuta', async () => {
    let soltar: () => void = () => {}
    const fn = vi.fn(() => new Promise<{ ok: true }>((r) => { soltar = () => r({ ok: true }) }))
    const primera = accionIdempotente(opciones(), fn)
    await ceder(); await ceder(); await ceder()
    const segunda = await accionIdempotente(opciones({ esperaMaxMs: 0 }), fn)
    expect(segunda).toEqual({ error: 'en curso' })
    expect(fn).toHaveBeenCalledTimes(1)
    soltar()
    await primera
  })

  it('un resultado de FALLA no se guarda: el reintento vuelve a ejecutar', async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: 'Siigo no respondió' })
      .mockResolvedValueOnce({ ok: true })
    expect(await accionIdempotente(opciones(), fn)).toEqual({ ok: false, error: 'Siigo no respondió' })
    expect(await accionIdempotente(opciones(), fn)).toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('si la acción lanza, suelta la reserva y relanza', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ success: true })
    await expect(accionIdempotente(opciones(), fn)).rejects.toThrow('boom')
    expect(await accionIdempotente(opciones(), fn)).toEqual({ success: true })
  })

  it('la misma clave con OTROS argumentos es otra intención', async () => {
    const fn = vi.fn(async () => ({ ok: true }))
    await accionIdempotente(opciones({ args: ['neg-1', 100] }), fn)
    await accionIdempotente(opciones({ args: ['neg-1', 200] }), fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('otra persona con la misma clave no recibe el resultado ajeno', async () => {
    const fn = vi.fn(async () => ({ ok: true }))
    await accionIdempotente(opciones(), fn)
    await accionIdempotente(opciones({ persona: { usuarioId: 'u-2', workspaceId: 'ws-1' } }), fn)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(claveEfectiva('pagar', 'u-1', CLAVE, [1])).not.toBe(claveEfectiva('pagar', 'u-2', CLAVE, [1]))
  })

  it('sin clave (o con una mal formada) corre como siempre, sin tocar la tabla', async () => {
    const fn = vi.fn(async () => ({ ok: true }))
    await accionIdempotente(opciones({ clave: undefined }), fn)
    await accionIdempotente(opciones({ clave: 'x' }), fn)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(filas.size).toBe(0)
  })

  it('sin la tabla (migración sin aplicar) corre sin protección', async () => {
    sinTabla = true
    const espia = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fn = vi.fn(async () => ({ ok: true }))
    expect(await accionIdempotente(opciones(), fn)).toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(1)
    espia.mockRestore()
  })

  it('una reserva que murió en curso (más de 6 min) se toma y se ejecuta', async () => {
    const clave = claveEfectiva('pagar', 'u-1', CLAVE, ['neg-1', 100])
    filas.set(clave, { clave, estado: 'en_curso', creada_at: new Date(Date.now() - 7 * 60_000).toISOString() })
    const espia = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fn = vi.fn(async () => ({ ok: true }))
    expect(await accionIdempotente(opciones(), fn)).toEqual({ ok: true })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(filas.get(clave)?.estado).toBe('hecha')
    espia.mockRestore()
  })
})
