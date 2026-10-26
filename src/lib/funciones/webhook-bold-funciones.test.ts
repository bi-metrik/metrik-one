import { describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { config_extra: {} }, error: null }) }) }) }) }),
}))

import { atenderWebhookBoldFunciones } from './webhook-bold-funciones'

const WS_A = '4d0a0f45-7425-4d4d-8495-cc78cdd5cf92'
const WS_B = '11111111-2222-4333-8444-555555555555'
const LLAVES: Record<string, Record<string, string>> = {
  [WS_A]: { bold_identity_key: 'idA-AAAA1111', bold_secret_key: 'secretaA-AAAA1111' },
  [WS_B]: { bold_identity_key: 'idB-BBBB2222', bold_secret_key: 'secretaB-BBBB2222' },
}
const firma = (cuerpo: string, k: string) => createHmac('sha256', k).update(Buffer.from(cuerpo, 'utf8').toString('base64')).digest('hex')
const evento = (o: { id?: string; type?: string; ref?: string; total?: number } = {}) =>
  JSON.stringify({
    id: o.id ?? 'notif-1',
    type: o.type ?? 'SALE_APPROVED',
    subject: 'TX1',
    data: { payment_id: 'TX1', amount: { currency: 'COP', total: o.total ?? 120000 }, metadata: { reference: o.ref ?? 'LNK_ABC123' }, integration: 'LINK' },
  })

/** La base de mentiras: llaves por workspace y `funcion_registrar_pago` idempotente por referencia, como la real. */
function base(llaves = LLAVES, estadoPrevio: Record<string, string> = {}) {
  const pagos: Record<string, string> = { [`${WS_A}:LNK_ABC123`]: 'pendiente', ...estadoPrevio }
  const registros: unknown[] = []
  const rpc = vi.fn(async (fn: string, a: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }> => {
    if (fn === 'leer_secretos_workspace') return { data: llaves[a.p_workspace_id as string] ?? {}, error: null }
    if (fn === 'boveda_estado') return { data: [], error: null }
    if (fn === 'funcion_registrar_pago') {
      const k = `${a.p_workspace_id}:${a.p_referencia}`
      if (!(k in pagos)) return { data: null, error: { code: 'P0001', message: 'pago_no_existe' } }
      if (pagos[k] !== 'pendiente') return { data: { estado: pagos[k], repetida: true }, error: null }
      pagos[k] = a.p_estado as string
      registros.push(a)
      return { data: { estado: a.p_estado, repetida: false }, error: null }
    }
    throw new Error(`rpc inesperada ${fn}`)
  })
  return { cliente: { rpc }, pagos, registros, rpc }
}

describe('webhook de Bold por workspace', () => {
  it('firma válida del workspace A: registra el pago aprobado con el LNK y el monto', async () => {
    const b = base()
    const c = evento()
    const r = await atenderWebhookBoldFunciones(WS_A, c, firma(c, 'secretaA-AAAA1111'), { cliente: b.cliente })
    expect(r.status).toBe(200)
    expect(b.registros).toEqual([{ p_workspace_id: WS_A, p_referencia: 'LNK_ABC123', p_estado: 'aprobado', p_monto_recibido: 120000 }])
  })

  it('firma del workspace A dirigida al workspace B: 401 sin escribir', async () => {
    const b = base()
    const c = evento()
    const f = vi.fn(async () => new Response('{}', { status: 404 }))
    const r = await atenderWebhookBoldFunciones(WS_B, c, firma(c, 'secretaA-AAAA1111'), { cliente: b.cliente, fetch: f as unknown as typeof fetch })
    expect(r.status).toBe(401)
    expect(b.rpc.mock.calls.some(([fn]) => fn === 'funcion_registrar_pago')).toBe(false)
  })

  it('workspace sin llaves: 401 aunque la firma sea de la llave de MéTRIK', async () => {
    vi.stubEnv('BOLD_SECRET_KEY', 'metrik-secreta')
    const b = base({})
    const c = evento()
    const r = await atenderWebhookBoldFunciones(WS_A, c, firma(c, 'metrik-secreta'), { cliente: b.cliente })
    expect(r).toEqual({ status: 401, body: { ok: false, motivo: 'no_configurado' } })
    vi.unstubAllEnvs()
  })

  it('el mismo evento dos veces: un solo pago', async () => {
    const b = base()
    const c = evento()
    const s = firma(c, 'secretaA-AAAA1111')
    await atenderWebhookBoldFunciones(WS_A, c, s, { cliente: b.cliente })
    const r2 = await atenderWebhookBoldFunciones(WS_A, c, s, { cliente: b.cliente })
    expect(r2.status).toBe(200)
    expect(r2.body.repetida).toBe(true)
    expect(b.registros).toHaveLength(1)
  })

  it('rechazado → fallido; anulación y pagos sin link no tocan nada', async () => {
    const b = base()
    const rech = evento({ type: 'SALE_REJECTED' })
    await atenderWebhookBoldFunciones(WS_A, rech, firma(rech, 'secretaA-AAAA1111'), { cliente: b.cliente })
    expect(b.registros).toEqual([expect.objectContaining({ p_estado: 'fallido' })])
    const anul = evento({ type: 'VOID_APPROVED', ref: 'LNK_OTRO' })
    expect((await atenderWebhookBoldFunciones(WS_A, anul, firma(anul, 'secretaA-AAAA1111'), { cliente: b.cliente })).body.ignorado).toBe('VOID_APPROVED')
    const qr = evento({ ref: '1730000000000' })
    expect((await atenderWebhookBoldFunciones(WS_A, qr, firma(qr, 'secretaA-AAAA1111'), { cliente: b.cliente })).body.ignorado).toBe('sin_link')
  })

  it('un link que no es de funciones: 200 para que Bold no reintente, sin escribir', async () => {
    const b = base()
    const c = evento({ ref: 'LNK_AJENO' })
    const r = await atenderWebhookBoldFunciones(WS_A, c, firma(c, 'secretaA-AAAA1111'), { cliente: b.cliente })
    expect(r).toEqual({ status: 200, body: { ok: true, ignorado: 'pago_no_existe' } })
  })

  describe('ambiente de pruebas (Bold firma con la llave vacía)', () => {
    const c = evento()
    const vacia = firma(c, '')
    const consulta = (d: Record<string, unknown>) => vi.fn(async () => new Response(JSON.stringify(d), { status: 200 }))

    const pruebas = { esEspacioDePruebas: async () => true }

    it('se acepta en un espacio de pruebas si Bold dice que el link es de pruebas y está pagado', async () => {
      const b = base()
      const f = consulta({ status: 'PAID', is_sandbox: true, total: 120000 })
      const r = await atenderWebhookBoldFunciones(WS_A, c, vacia, { ...pruebas, cliente: b.cliente, fetch: f as unknown as typeof fetch })
      expect(r.status).toBe(200)
      expect(r.body.modo).toBe('pruebas')
      const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
      expect((init.headers as Record<string, string>).Authorization).toBe('x-api-key idA-AAAA1111')
    })

    it('se rechaza si el link es real (llaves de producción) o no está pagado', async () => {
      for (const d of [{ status: 'PAID', is_sandbox: false }, { status: 'ACTIVE', is_sandbox: true }]) {
        const b = base()
        const r = await atenderWebhookBoldFunciones(WS_A, c, vacia, { ...pruebas, cliente: b.cliente, fetch: consulta(d) as unknown as typeof fetch })
        expect(r.status).toBe(401)
        expect(b.registros).toHaveLength(0)
      }
    })

    it('en un workspace real (sabor) se rechaza SIEMPRE, aunque Bold diga is_sandbox y pagado, sin consultar a Bold', async () => {
      const b = base()
      const f = consulta({ status: 'PAID', is_sandbox: true, total: 120000 })
      const r = await atenderWebhookBoldFunciones(WS_A, c, vacia, { esEspacioDePruebas: async () => false, cliente: b.cliente, fetch: f as unknown as typeof fetch })
      expect(r).toEqual({ status: 401, body: { ok: false, motivo: 'firma_invalida' } })
      expect(f).not.toHaveBeenCalled()
      expect(b.registros).toHaveLength(0)
    })
  })

  it('la secreta anterior vale solo los días de gracia', async () => {
    const llaves = { [WS_A]: { bold_identity_key: 'idA2', bold_secret_key: 'secretaNueva-1234', bold_secret_key_anterior: 'secretaA-AAAA1111' } }
    const c = evento()
    const s = firma(c, 'secretaA-AAAA1111')
    const ahora = Date.parse('2026-11-10T00:00:00Z')
    const conFecha = (iso: string) => {
      const b = base(llaves)
      const rpcBase = b.rpc.getMockImplementation()!
      b.rpc.mockImplementation(async (fn: string, a: Record<string, unknown>) =>
        fn === 'boveda_estado' ? { data: [{ clave: 'bold_secret_key_anterior', actualizado_at: iso }], error: null } : rpcBase(fn, a),
      )
      return b
    }
    const reciente = conFecha('2026-11-08T00:00:00Z')
    expect((await atenderWebhookBoldFunciones(WS_A, c, s, { cliente: reciente.cliente, ahora: () => ahora })).body.modo).toBe('cuenta_anterior')
    const vieja = conFecha('2026-10-01T00:00:00Z')
    const f = vi.fn(async () => new Response('{}', { status: 404 }))
    expect((await atenderWebhookBoldFunciones(WS_A, c, s, { cliente: vieja.cliente, ahora: () => ahora, fetch: f as unknown as typeof fetch })).status).toBe(401)
  })

  it('ninguna llave ni firma aparece en respuestas ni logs', async () => {
    const logs: string[] = []
    const spies = (['log', 'warn', 'error'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a) => void logs.push(a.join(' '))))
    const c = evento()
    const s = firma(c, 'secretaA-AAAA1111')
    const respuestas = [
      await atenderWebhookBoldFunciones(WS_A, c, s, { cliente: base().cliente }),
      await atenderWebhookBoldFunciones(WS_B, c, s, { cliente: base().cliente, fetch: (async () => new Response('{}')) as unknown as typeof fetch }),
      await atenderWebhookBoldFunciones(WS_A, c, null, { cliente: base().cliente }),
    ]
    spies.forEach((sp) => sp.mockRestore())
    const todo = JSON.stringify(respuestas) + logs.join('\n')
    for (const k of ['secretaA-AAAA1111', 'secretaB-BBBB2222', 'idA-AAAA1111', 'idB-BBBB2222', s]) expect(todo).not.toContain(k)
  })
})
