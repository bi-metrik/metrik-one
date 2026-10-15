import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { cobroDeReferencia, referenciaEnlaceCobro } from '@/lib/cobros/referencia-enlace'
import { TODOS_LOS_DOMINIOS_DE_PAGO, etiquetaFuentePago } from './dominios'
import {
  EPAYCO_APIFY_BASE,
  MOTIVO_EPAYCO_SIN_LLAVE,
  crearEnlaceEpayco,
  cuerpoConfirmacionEpayco,
  fechaExpiracionEpayco,
  firmaEpayco,
  idEnlaceEpaycoDeUrl,
  parsearConfirmacionEpayco,
  pasarelaEpayco,
  urlConfirmacionEpayco,
  verificarConfirmacionEpayco,
} from './epayco'
import { adapterPara } from './registro'

const ENV = {
  EPAYCO_METRIK_PUBLIC_KEY: 'publica',
  EPAYCO_METRIK_PRIVATE_KEY: 'privada',
  EPAYCO_METRIK_CUST_ID: '1234567',
  EPAYCO_METRIK_P_KEY: 'pkey-de-prueba',
  NEXT_PUBLIC_BASE_DOMAIN: 'metrikone.co',
}
const COBRO = '0f8e2f4a-1c2b-4d5e-9f00-112233445566'
const REF = referenciaEnlaceCobro(COBRO, 1_792_000_000_000)

/** Una confirmación como la documenta ePayco, firmada con las llaves de prueba. */
function confirmacion(campos: Record<string, string> = {}, firma?: string) {
  const base: Record<string, string> = {
    x_cust_id_cliente: '1234567',
    x_ref_payco: '386159602',
    x_transaction_id: '3861596021792000000',
    x_amount: '150000',
    x_currency_code: 'COP',
    x_cod_transaction_state: '1',
    x_transaction_state: 'Aceptada',
    x_transaction_date: '2026-10-08 20:15:00',
    x_test_request: 'FALSE',
    ...campos,
  }
  const x_signature =
    firma ??
    createHash('sha256')
      .update(['1234567', 'pkey-de-prueba', base.x_ref_payco, base.x_transaction_id, base.x_amount, base.x_currency_code].join('^'))
      .digest('hex')
  return new URLSearchParams({ ...base, x_signature }).toString()
}

function respuesta(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('el registro y la pantalla conocen a ePayco', () => {
  it('adapterPara("epayco") es el adaptador de links', () => {
    expect(adapterPara('epayco')).toBe(pasarelaEpayco)
    expect(pasarelaEpayco.capacidades.linkDePago).toBe(true)
  })

  it('el botón de pago acepta payco.link y el pago se nombra «Pago en línea»', () => {
    expect(TODOS_LOS_DOMINIOS_DE_PAGO).toContain('payco.link')
    expect(etiquetaFuentePago('epayco')).toBe('Pago en línea')
  })

  it('el id del link sale de su URL y no confunde otras', () => {
    expect(idEnlaceEpaycoDeUrl('https://payco.link/82586')).toBe('82586')
    expect(idEnlaceEpaycoDeUrl('https://checkout.bold.co/LNK_ABC')).toBeNull()
    expect(idEnlaceEpaycoDeUrl('https://payco.link/abc')).toBeNull()
    expect(idEnlaceEpaycoDeUrl('no es url')).toBeNull()
  })
})

describe('crear el link de cobro', () => {
  it('sin llaves no llama a ePayco y lo dice', async () => {
    const f = vi.fn()
    const r = await crearEnlaceEpayco({ monto: 150_000, descripcion: 'Cuota', referencia: REF, expiraMs: 0 }, { env: {}, fetch: f })
    expect(r).toEqual({ ok: false, error: MOTIVO_EPAYCO_SIN_LLAVE, reintentable: false })
    expect(f).not.toHaveBeenCalled()
    expect(pasarelaEpayco.faltaConfiguracion).toBeDefined()
  })

  it('ingresa con Basic, crea el link de monto cerrado y sin IVA, y devuelve payco.link', async () => {
    const llamadas: { url: string; init: RequestInit }[] = []
    const f = vi.fn(async (url: string, init: RequestInit) => {
      llamadas.push({ url, init })
      if (url.endsWith('/login')) return respuesta({ token: 'jwt-de-prueba' })
      return respuesta({ success: true, data: { id: 82586, routeLink: 'https://payco.link/82586' } })
    }) as unknown as typeof fetch
    const expiraMs = Date.UTC(2026, 9, 21, 15, 0, 0)
    const r = await crearEnlaceEpayco(
      { monto: 150_000, descripcion: 'Suscripción MeTRIK ONE · Termotech · periodo del 5-mar al 4-abr', referencia: REF, expiraMs },
      { env: ENV, fetch: f },
    )
    expect(r).toEqual({ ok: true, idEnlace: '82586', url: 'https://payco.link/82586', expira: new Date(expiraMs).toISOString() })

    expect(llamadas[0].url).toBe(`${EPAYCO_APIFY_BASE}/login`)
    expect((llamadas[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('publica:privada').toString('base64')}`)
    expect(llamadas[1].url).toBe(`${EPAYCO_APIFY_BASE}/collection/link/create`)
    expect((llamadas[1].init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-de-prueba')
    const cuerpo = JSON.parse(String(llamadas[1].init.body))
    expect(cuerpo).toMatchObject({
      quantity: 1,
      onePayment: true,
      amount: '150000',
      currency: 'COP',
      id: 0,
      typeSell: '2',
      tax: '0',
      methodConfirmation: 'POST',
      expirationDate: '2026-10-21 15:00:00',
    })
    expect(cuerpo.urlConfirmation).toBe(`https://metrikone.co/api/webhooks/epayco?ref=${REF}`)
    // Sin urlResponse: los datos firmados no pasan por el navegador del pagador.
    expect(cuerpo).not.toHaveProperty('urlResponse')
  })

  it('un rechazo de ePayco queda escrito; un 5xx se puede reintentar', async () => {
    const rechazo = vi.fn(async (url: string) =>
      url.endsWith('/login')
        ? respuesta({ token: 't' })
        : respuesta({ success: false, data: { errors: [{ codError: 500, errorMessage: 'field amount required' }] } }),
    ) as unknown as typeof fetch
    const r = await crearEnlaceEpayco({ monto: 150_000, descripcion: 'x', referencia: REF, expiraMs: 0 }, { env: ENV, fetch: rechazo })
    expect(r).toMatchObject({ ok: false, reintentable: false })
    if (!r.ok) expect(r.error).toContain('field amount required')

    const caido = vi.fn(async () => respuesta({}, 503)) as unknown as typeof fetch
    expect(await crearEnlaceEpayco({ monto: 150_000, descripcion: 'x', referencia: REF, expiraMs: 0 }, { env: ENV, fetch: caido })).toMatchObject({
      ok: false,
      reintentable: true,
    })
  })

  it('no manda montos que no sean pesos enteros', async () => {
    const f = vi.fn()
    expect(await crearEnlaceEpayco({ monto: 1500.5, descripcion: 'x', referencia: REF, expiraMs: 0 }, { env: ENV, fetch: f })).toMatchObject({ ok: false })
    expect(f).not.toHaveBeenCalled()
  })

  it('la expiración va en UTC sin zona', () => {
    expect(fechaExpiracionEpayco(Date.UTC(2027, 1, 26, 4, 30, 9))).toBe('2027-02-26 04:30:09')
    expect(urlConfirmacionEpayco('ONE-a-1', {})).toBe('https://metrikone.co/api/webhooks/epayco?ref=ONE-a-1')
  })
})

describe('la confirmación', () => {
  it('firmada y aceptada: un evento aprobado que vuelve al cobro por la referencia de ONE', () => {
    const crudo = cuerpoConfirmacionEpayco(confirmacion(), 'application/x-www-form-urlencoded', new URLSearchParams({ ref: REF }))
    const v = verificarConfirmacionEpayco(crudo, ENV)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.evento).toMatchObject({
      tipo: 'aprobado',
      eventoId: '386159602-1',
      transaccionId: '386159602',
      referenciaPago: 'epayco-386159602',
      referencia: REF,
      monto: 150_000,
      moneda: 'COP',
      // 20:15 de Bogotá sigue siendo el 8: no se corre al día siguiente en un servidor en UTC.
      ocurridoAt: '2026-10-08T12:00:00-05:00',
    })
    expect(cobroDeReferencia(v.evento.referencia)).toBe(COBRO)
    expect(JSON.stringify(v.evento.crudo)).not.toContain('x_signature')
  })

  it('la firma es la de la documentación: sha256 de id^p_key^ref^transacción^monto^moneda', () => {
    expect(firmaEpayco({ idCliente: 'a', pKey: 'b', refPayco: 'c', transaccionId: 'd', monto: 'e', moneda: 'f' })).toBe(
      createHash('sha256').update('a^b^c^d^e^f').digest('hex'),
    )
  })

  it('un monto cambiado, una firma ajena o sin firma no pasan', () => {
    const adulterada = confirmacion().replace('x_amount=150000', 'x_amount=1500000')
    expect(verificarConfirmacionEpayco(adulterada, ENV)).toEqual({ ok: false, motivo: 'firma_invalida' })
    expect(verificarConfirmacionEpayco(confirmacion({}, 'f'.repeat(64)), ENV)).toEqual({ ok: false, motivo: 'firma_invalida' })
    expect(verificarConfirmacionEpayco('x_ref_payco=1', ENV)).toEqual({ ok: false, motivo: 'sin_firma' })
    expect(verificarConfirmacionEpayco(confirmacion(), {})).toEqual({ ok: false, motivo: 'no_configurado' })
  })

  it('pendiente y aceptada de la misma transacción son dos notificaciones distintas', () => {
    const pendiente = parsearConfirmacionEpayco(confirmacion({ x_cod_transaction_state: '3', x_transaction_state: 'Pendiente' }))
    const aceptada = parsearConfirmacionEpayco(confirmacion())
    expect(pendiente?.tipo).toBe('otro')
    expect(pendiente?.eventoId).not.toBe(aceptada?.eventoId)
    expect(pendiente?.referenciaPago).toBe(aceptada?.referenciaPago)
  })

  it('rechazada, reversada y de prueba no registran plata', () => {
    expect(parsearConfirmacionEpayco(confirmacion({ x_cod_transaction_state: '2' }))?.tipo).toBe('rechazado')
    expect(parsearConfirmacionEpayco(confirmacion({ x_cod_transaction_state: '6' }))?.tipo).toBe('anulado')
    expect(parsearConfirmacionEpayco(confirmacion({ x_test_request: 'TRUE' }))?.tipo).toBe('otro')
  })

  it('acepta la confirmación en JSON y por GET; la consulta no pisa un campo de ePayco', () => {
    const json = JSON.stringify(Object.fromEntries(new URLSearchParams(confirmacion())))
    expect(verificarConfirmacionEpayco(cuerpoConfirmacionEpayco(json, 'application/json', new URLSearchParams({ ref: REF })), ENV).ok).toBe(true)

    const porGet = cuerpoConfirmacionEpayco('', null, new URLSearchParams(`${confirmacion()}&ref=${REF}`))
    expect(verificarConfirmacionEpayco(porGet, ENV).ok).toBe(true)

    const pisada = cuerpoConfirmacionEpayco(confirmacion(), null, new URLSearchParams({ ref: REF, x_amount: '1' }))
    expect(new URLSearchParams(pisada).get('x_amount')).toBe('150000')
  })

  it('sin recibo o sin estado no es una confirmación', () => {
    expect(parsearConfirmacionEpayco('x_amount=1')).toBeNull()
  })
})
