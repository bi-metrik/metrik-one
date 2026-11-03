import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { firmaBold, firmaBoldValida, pasarelaConLlaves, pasarelaDeWorkspace, probarConexionBold, sinLlaves } from './bold-workspace'

const LLAVE_WS = 'ws-identidad-AAAA1111'
const LLAVE_METRIK = 'metrik-identidad-ZZZZ9999'
const PEDIDO = { pagoId: 'p1', monto: 120000, venceAt: '2026-11-09T23:00:00Z', descripcion: 'Reserva cena' }

const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } })
const cliente = (data: unknown) => ({ rpc: vi.fn(async () => ({ data, error: null })) })

afterEach(() => vi.unstubAllEnvs())

describe('pasarela del workspace', () => {
  it('sin llaves del workspace NO hay pasarela, aunque el servidor tenga la llave de MéTRIK', async () => {
    vi.stubEnv('BOLD_IDENTITY_KEY', LLAVE_METRIK)
    const f = vi.fn()
    expect(await pasarelaDeWorkspace(cliente({}), 'ws-1', f as unknown as typeof fetch)).toBeNull()
    expect(pasarelaConLlaves({}, f as unknown as typeof fetch)).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('con la llave del workspace crea el link con ESA llave y guarda el LNK como referencia', async () => {
    vi.stubEnv('BOLD_IDENTITY_KEY', LLAVE_METRIK)
    const f = vi.fn(async () => ok({ payload: { payment_link: 'LNK_ABC123', url: 'https://checkout.bold.co/LNK_ABC123' }, errors: [] }))
    const p = await pasarelaDeWorkspace(cliente({ bold_identity_key: LLAVE_WS }), 'ws-1', f as unknown as typeof fetch)
    expect(await p!.crearLink(PEDIDO)).toEqual({ ok: true, referencia: 'LNK_ABC123', url: 'https://checkout.bold.co/LNK_ABC123' })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://integrations.api.bold.co/online/link/v1')
    expect((init.headers as Record<string, string>).Authorization).toBe(`x-api-key ${LLAVE_WS}`)
    expect(JSON.stringify(init)).not.toContain(LLAVE_METRIK)
    expect(JSON.parse(init.body as string)).toMatchObject({ amount_type: 'CLOSE', amount: { currency: 'COP', total_amount: 120000 } })
  })

  it('un error de Bold que cite la llave sale sin ella', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: `llave ${LLAVE_WS} inválida` }] }), { status: 401 }))
    const r = await pasarelaConLlaves({ identidad: LLAVE_WS }, f as unknown as typeof fetch)!.crearLink(PEDIDO)
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain(LLAVE_WS)
    expect(sinLlaves(`x ${LLAVE_WS} y`, [LLAVE_WS])).toBe('x [llave] y')
  })

  it('probar conexión responde solo sí o no', async () => {
    expect(await probarConexionBold(LLAVE_WS, (async () => ok({ payload: {} })) as unknown as typeof fetch)).toBe(true)
    expect(await probarConexionBold(LLAVE_WS, (async () => new Response('', { status: 401 })) as unknown as typeof fetch)).toBe(false)
    expect(await probarConexionBold(LLAVE_WS, (async () => { throw new Error(LLAVE_WS) }) as unknown as typeof fetch)).toBe(false)
  })
})

describe('firma del webhook (WebCrypto, igual que node:crypto)', () => {
  const cuerpo = JSON.stringify({ id: 'n1', type: 'SALE_APPROVED', data: { metadata: { reference: 'LNK_ABC123' }, nota: 'ñandú €' } })
  const node = (k: string) => createHmac('sha256', k).update(Buffer.from(cuerpo, 'utf8').toString('base64')).digest('hex')

  it('con llave', async () => {
    expect(await firmaBold(cuerpo, 'secreta-1')).toBe(node('secreta-1'))
    expect(await firmaBoldValida(cuerpo, node('secreta-1'), 'secreta-1')).toBe(true)
    expect(await firmaBoldValida(cuerpo, node('secreta-2'), 'secreta-1')).toBe(false)
  })

  it('con la llave vacía del ambiente de pruebas', async () => {
    expect(await firmaBold(cuerpo, '')).toBe(node(''))
  })
})
