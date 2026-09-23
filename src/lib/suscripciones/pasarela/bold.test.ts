import { createHmac } from 'node:crypto'
import { describe, it, expect, vi } from 'vitest'
import {
  BOLD_API_BASE,
  MOTIVO_BOLD_SIN_LLAVE,
  consultarEnlaceBold,
  crearEnlaceBold,
  descripcionEnlace,
  firmaBold,
  firmaBoldValida,
  idEnlaceDeUrl,
  parsearEventoBold,
  pasarelaBold,
  verificarWebhookBold,
} from './bold'
import { adapterPara } from './registro'

const SECRETA = 'llave-secreta-de-prueba'
const ENV = { BOLD_IDENTITY_KEY: 'identidad-de-prueba', BOLD_SECRET_KEY: SECRETA }

/** El cuerpo de ejemplo de la documentación de Bold (venta aprobada por enlace, tarjeta web). */
const CUERPO = JSON.stringify({
  id: 'a9c1d0f5-3b7e-4d2a-9f6c-8e4b5d2f0a1b',
  type: 'SALE_APPROVED',
  subject: 'CNPCGSPS2WBA8',
  source: '/payments/links',
  spec_version: '1.0',
  time: 1761063334000000000,
  data: {
    payment_id: 'CNPCGSPS2WBA8',
    merchant_id: 'MCNTR2025ABC',
    created_at: '2025-10-21T12:30:10-05:00',
    amount: { currency: 'COP', total: 59900, taxes: [], tip: 0 },
    metadata: { reference: 'ONE-0f8e2f4a1c2b4d5e9f00112233445566-1761063334000' },
    payment_method: 'CARD_WEB',
    integration: 'LINK',
  },
  datacontenttype: 'application/json',
})

describe('firma del webhook', () => {
  // La regla de la documentación: HMAC-SHA256 en hex sobre el cuerpo crudo codificado en BASE64.
  it('se calcula sobre el base64 del cuerpo, no sobre el cuerpo', () => {
    const esperada = createHmac('sha256', SECRETA).update(Buffer.from(CUERPO).toString('base64')).digest('hex')
    expect(firmaBold(CUERPO, SECRETA)).toBe(esperada)
    expect(firmaBold(CUERPO, SECRETA)).not.toBe(createHmac('sha256', SECRETA).update(CUERPO).digest('hex'))
  })

  it('una firma válida pasa, en mayúsculas también', () => {
    const f = firmaBold(CUERPO, SECRETA)
    expect(firmaBoldValida(CUERPO, f, SECRETA)).toBe(true)
    expect(firmaBoldValida(CUERPO, f.toUpperCase(), SECRETA)).toBe(true)
  })

  it('una firma de otra llave, de otro cuerpo, vacía o de otro largo no pasa', () => {
    expect(firmaBoldValida(CUERPO, firmaBold(CUERPO, 'otra-llave'), SECRETA)).toBe(false)
    expect(firmaBoldValida(CUERPO, firmaBold(CUERPO.replace('59900', '1'), SECRETA), SECRETA)).toBe(false)
    expect(firmaBoldValida(CUERPO, '', SECRETA)).toBe(false)
    expect(firmaBoldValida(CUERPO, null, SECRETA)).toBe(false)
    expect(firmaBoldValida(CUERPO, 'abc', SECRETA)).toBe(false)
  })

  it('verificarWebhookBold separa sin llave, sin firma, firma mala y cuerpo malo', () => {
    expect(verificarWebhookBold(CUERPO, { 'x-bold-signature': 'x' }, {})).toEqual({ ok: false, motivo: 'no_configurado' })
    expect(verificarWebhookBold(CUERPO, {}, ENV)).toEqual({ ok: false, motivo: 'sin_firma' })
    expect(verificarWebhookBold(CUERPO, { 'x-bold-signature': firmaBold(CUERPO, 'otra') }, ENV)).toEqual({ ok: false, motivo: 'firma_invalida' })
    const malo = '{"sin":"id"}'
    expect(verificarWebhookBold(malo, { 'x-bold-signature': firmaBold(malo, SECRETA) }, ENV)).toEqual({ ok: false, motivo: 'cuerpo_invalido' })
  })

  it('con firma válida devuelve el evento normalizado', () => {
    const v = verificarWebhookBold(CUERPO, { 'x-bold-signature': firmaBold(CUERPO, SECRETA) }, ENV)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.evento).toMatchObject({
      eventoId: 'a9c1d0f5-3b7e-4d2a-9f6c-8e4b5d2f0a1b',
      tipo: 'aprobado',
      tipoOriginal: 'SALE_APPROVED',
      transaccionId: 'CNPCGSPS2WBA8',
      referenciaPago: 'bold-CNPCGSPS2WBA8',
      idEnlace: null,
      monto: 59900,
      moneda: 'COP',
      ocurridoAt: '2025-10-21T12:30:10-05:00',
    })
  })
})

describe('parsearEventoBold', () => {
  it('mapea los cuatro tipos y cae a `otro`', () => {
    const tipo = (type: string) => parsearEventoBold(JSON.stringify({ id: 'e', type, data: { payment_id: 'p' } }))?.tipo
    expect(tipo('SALE_APPROVED')).toBe('aprobado')
    expect(tipo('SALE_REJECTED')).toBe('rechazado')
    expect(tipo('VOID_APPROVED')).toBe('anulado')
    expect(tipo('VOID_REJECTED')).toBe('otro')
  })

  it('una referencia LNK_ se entrega como id del enlace, para volver al cobro por su URL', () => {
    const e = parsearEventoBold(JSON.stringify({ id: 'e', type: 'SALE_APPROVED', data: { payment_id: 'p', metadata: { reference: 'LNK_ABC123' } } }))
    expect(e?.idEnlace).toBe('LNK_ABC123')
  })

  it('sin payment_id usa el subject; sin id ni transacción no hay evento', () => {
    expect(parsearEventoBold(JSON.stringify({ id: 'e', type: 'SALE_APPROVED', subject: 'S1' }))?.transaccionId).toBe('S1')
    expect(parsearEventoBold(JSON.stringify({ type: 'SALE_APPROVED', subject: 'S1' }))).toBeNull()
    expect(parsearEventoBold('no es json')).toBeNull()
  })
})

describe('referencias', () => {
  it('el id del enlace sale de las dos formas de URL de Bold', () => {
    expect(idEnlaceDeUrl('https://checkout.bold.co/LNK_H7S4xxx')).toBe('LNK_H7S4xxx')
    expect(idEnlaceDeUrl('https://checkout.bold.co/payment/LNK_ABC123')).toBe('LNK_ABC123')
    expect(idEnlaceDeUrl('https://checkout.bold.co/payment/otra-cosa')).toBeNull()
    expect(idEnlaceDeUrl('no es url')).toBeNull()
  })

  it('la descripción queda entre 2 y 100 caracteres', () => {
    expect(descripcionEnlace('x')).toBe('Pago de cuota')
    expect(descripcionEnlace('a'.repeat(150)).length).toBe(100)
    expect(descripcionEnlace('  Cuota 1\n periodo  ')).toBe('Cuota 1 periodo')
  })
})

function respuesta(status: number, cuerpo: unknown) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })
}

describe('crearEnlaceBold', () => {
  const solicitud = { monto: 250000, descripcion: 'Licencia VALIDA — periodo del 23/09/2026 al 22/10/2026', referencia: 'ONE-abc-1', expiraMs: 1_790_000_000_000 }

  it('sin llave de identidad no llama a nadie y lo dice', async () => {
    const f = vi.fn()
    const r = await crearEnlaceBold(solicitud, { fetch: f as unknown as typeof fetch, env: {} })
    expect(r).toEqual({ ok: false, error: MOTIVO_BOLD_SIN_LLAVE, reintentable: false })
    expect(f).not.toHaveBeenCalled()
  })

  it('manda lo que pide la documentación y devuelve el enlace', async () => {
    const f = vi.fn().mockResolvedValue(
      respuesta(200, { payload: { payment_link: 'LNK_H7S4xxx', url: 'https://checkout.bold.co/LNK_H7S4xxx' }, errors: [] }),
    )
    const r = await crearEnlaceBold(solicitud, { fetch: f as unknown as typeof fetch, env: ENV })
    expect(r).toEqual({
      ok: true,
      idEnlace: 'LNK_H7S4xxx',
      url: 'https://checkout.bold.co/LNK_H7S4xxx',
      expira: new Date(1_790_000_000_000).toISOString(),
    })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe(`${BOLD_API_BASE}/online/link/v1`)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('x-api-key identidad-de-prueba')
    const cuerpo = JSON.parse(init.body)
    expect(cuerpo).toMatchObject({
      amount_type: 'CLOSE',
      amount: { currency: 'COP', total_amount: 250000, tip_amount: 0 },
      reference: 'ONE-abc-1',
    })
    // Nanosegundos: 19 dígitos.
    expect(String(cuerpo.expiration_date)).toHaveLength(19)
    expect(cuerpo.description.length).toBeLessThanOrEqual(100)
    // La llave secreta no viaja nunca a crear el enlace.
    expect(JSON.stringify(init)).not.toContain(SECRETA)
  })

  it('un rechazo de Bold vuelve con su mensaje; un 5xx es reintentable, un 4xx no', async () => {
    const f400 = vi.fn().mockResolvedValue(respuesta(400, { payload: null, errors: [{ message: 'reference duplicated' }] }))
    const r400 = await crearEnlaceBold(solicitud, { fetch: f400 as unknown as typeof fetch, env: ENV })
    expect(r400.ok).toBe(false)
    if (!r400.ok) {
      expect(r400.error).toContain('reference duplicated')
      expect(r400.reintentable).toBe(false)
    }
    const f503 = vi.fn().mockResolvedValue(respuesta(503, {}))
    const r503 = await crearEnlaceBold(solicitud, { fetch: f503 as unknown as typeof fetch, env: ENV })
    expect(r503.ok === false && r503.reintentable).toBe(true)
  })

  it('un 200 con errores o sin enlace no se da por bueno', async () => {
    const conErrores = vi.fn().mockResolvedValue(respuesta(200, { payload: {}, errors: ['monto fuera de rango'] }))
    expect((await crearEnlaceBold(solicitud, { fetch: conErrores as unknown as typeof fetch, env: ENV })).ok).toBe(false)
    const sinEnlace = vi.fn().mockResolvedValue(respuesta(200, { payload: { url: 'http://inseguro/x' }, errors: [] }))
    expect((await crearEnlaceBold(solicitud, { fetch: sinEnlace as unknown as typeof fetch, env: ENV })).ok).toBe(false)
  })

  it('la red caída es un error reintentable, no una excepción', async () => {
    const f = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const r = await crearEnlaceBold(solicitud, { fetch: f as unknown as typeof fetch, env: ENV })
    expect(r).toMatchObject({ ok: false, reintentable: true })
  })

  it('rechaza sin llamar un monto no entero o una referencia con caracteres raros', async () => {
    const f = vi.fn()
    expect((await crearEnlaceBold({ ...solicitud, monto: 10.5 }, { fetch: f as unknown as typeof fetch, env: ENV })).ok).toBe(false)
    expect((await crearEnlaceBold({ ...solicitud, referencia: 'con espacio' }, { fetch: f as unknown as typeof fetch, env: ENV })).ok).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('consultarEnlaceBold', () => {
  it('lee el estado, suelto o dentro de payload', async () => {
    const suelto = vi.fn().mockResolvedValue(respuesta(200, { id: 'LNK_A1', status: 'PAID', transaction_id: 'T1', total: 100 }))
    expect(await consultarEnlaceBold('LNK_A1', { fetch: suelto as unknown as typeof fetch, env: ENV })).toEqual({
      ok: true, estado: 'PAID', transaccionId: 'T1', total: 100,
    })
    const envuelto = vi.fn().mockResolvedValue(respuesta(200, { payload: { status: 'ACTIVE' } }))
    const r = await consultarEnlaceBold('LNK_A1', { fetch: envuelto as unknown as typeof fetch, env: ENV })
    expect(r.ok && r.estado).toBe('ACTIVE')
  })

  it('sin llave o con un id que no es de Bold no llama', async () => {
    const f = vi.fn()
    expect((await consultarEnlaceBold('LNK_A1', { fetch: f as unknown as typeof fetch, env: {} })).ok).toBe(false)
    expect((await consultarEnlaceBold('../x', { fetch: f as unknown as typeof fetch, env: ENV })).ok).toBe(false)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('el adaptador', () => {
  it('queda registrado para `bold`', () => {
    expect(adapterPara('bold')).toBe(pasarelaBold)
  })

  it('crea enlaces, reconoce los suyos por la URL y dice si le faltan llaves', () => {
    expect(typeof pasarelaBold.crearEnlacePago).toBe('function')
    expect(pasarelaBold.idEnlaceDeUrl?.('https://checkout.bold.co/LNK_Z9')).toBe('LNK_Z9')
    expect(typeof pasarelaBold.faltaConfiguracion).toBe('function')
  })

  it('declara enlace y webhook, no cobro sin clic ni tokenización', () => {
    expect(pasarelaBold.capacidades).toEqual({ cobroSinClic: false, tokenizacion: false, linkDePago: true, webhook: true })
  })
})
