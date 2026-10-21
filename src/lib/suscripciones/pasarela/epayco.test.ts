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
  camposConfirmacion,
  cobrarConTokenEpayco,
  crearAdapterEpayco,
  eliminarTarjetasEpayco,
  faltaConfiguracionEpayco,
  firmaConfirmacion,
  llavePublicaEpayco,
  leerRefMedioPagoEpayco,
  refMedioPagoEpayco,
  registrarClienteEpayco,
  resultadoDeEstado,
} from './epayco'
import { adapterPara } from './registro'

const ENV = {
  EPAYCO_PUBLIC_KEY_METRIK: 'publica',
  EPAYCO_PRIVATE_KEY_METRIK: 'privada',
  EPAYCO_P_CUST_ID_CLIENTE: '1234567',
  EPAYCO_P_KEY: 'pkey-de-prueba',
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

// ─── Cargo con la tarjeta guardada (Valida autogestionada, #1191) ────────────────────────────

/**
 * ePayco en modo prueba, con la API simulada (no hay llaves todavía). Las formas de las peticiones y
 * respuestas son las de la colección oficial de APIFY y la documentación de confirmación.
 */

const ENV_TOKEN = {
  EPAYCO_HABILITADO: '1',
  EPAYCO_PUBLIC_KEY_METRIK: 'pub_123',
  EPAYCO_PRIVATE_KEY_METRIK: 'priv_456',
  EPAYCO_P_CUST_ID_CLIENTE: '901234',
  EPAYCO_P_KEY: 'pkey_789',
  VERCEL_ENV: 'preview',
}

type Llamada = { url: string; init: RequestInit }

function apiSimulada(respuestas: Record<string, unknown>) {
  const llamadas: Llamada[] = []
  const f = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init })
    const ruta = new URL(url).pathname
    const cuerpo = respuestas[ruta]
    if (cuerpo === undefined) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(cuerpo), { status: 200 })
  }) as unknown as typeof fetch
  return { f, llamadas }
}

const LOGIN = { token: 'jwt-de-prueba' }

describe('configuración y modo prueba', () => {
  it('apagado por defecto; sin llaves no opera', () => {
    expect(faltaConfiguracionEpayco({})).toMatch(/apagado/)
    expect(faltaConfiguracionEpayco({ EPAYCO_HABILITADO: '1' })).toMatch(/sin configurar/)
    expect(faltaConfiguracionEpayco(ENV_TOKEN)).toBeNull()
  })
  it('las llaves SIN sufijo _METRIK (otra cuenta de ePayco) no cuentan: sin configurar y no cobra', async () => {
    const ajenas = {
      EPAYCO_HABILITADO: '1',
      EPAYCO_PUBLIC_KEY: 'pub_otra_cuenta',
      EPAYCO_PRIVATE_KEY: 'priv_otra_cuenta',
      EPAYCO_P_CUST_ID_CLIENTE: '901234',
      EPAYCO_P_KEY: 'pkey_789',
      VERCEL_ENV: 'preview',
    }
    expect(faltaConfiguracionEpayco(ajenas)).toMatch(/sin configurar/)
    expect(llavePublicaEpayco(ajenas)).toBeNull()
    const api = apiSimulada({ '/login': LOGIN })
    const r = await registrarClienteEpayco(
      {
        cardTokenId: 'XCX92PZqBKfmcWFbA',
        pagador: { tipoDocumento: 'NIT', documento: '900123456', nombre: 'Ana', apellido: 'Pérez', email: 'ana@cda.co', celular: '3001234567' },
      },
      { env: ajenas, fetch: api.f },
    )
    expect(r.ok).toBe(false)
    expect(api.llamadas).toHaveLength(0)
    // Con los dos juegos definidos, manda la de METRIK.
    expect(llavePublicaEpayco({ ...ajenas, EPAYCO_PUBLIC_KEY_METRIK: 'pub_metrik' })).toBe('pub_metrik')
  })
  it('en modo prueba NO opera en el despliegue de producción (una tarjeta de prueba pagaría una cuota real)', () => {
    expect(faltaConfiguracionEpayco({ ...ENV_TOKEN, VERCEL_ENV: 'production' })).toMatch(/modo prueba/)
    expect(faltaConfiguracionEpayco({ ...ENV_TOKEN, VERCEL_ENV: 'production', EPAYCO_PRODUCCION: '1' })).toBeNull()
  })
})

describe('el medio de pago guardado es un puntero, nunca la tarjeta', () => {
  it('ida y vuelta de la referencia', () => {
    const ref = refMedioPagoEpayco('DiYPdhgncppes9KAb', 'XCX92PZqBKfmcWFbA')
    expect(ref).toBe('epayco:DiYPdhgncppes9KAb:XCX92PZqBKfmcWFbA')
    expect(leerRefMedioPagoEpayco(ref)).toEqual({ customerId: 'DiYPdhgncppes9KAb', cardTokenId: 'XCX92PZqBKfmcWFbA' })
    expect(leerRefMedioPagoEpayco('4575623182290326')).toBeNull()
    expect(leerRefMedioPagoEpayco(null)).toBeNull()
  })
})

describe('registrar el cliente con su token', () => {
  it('login Basic con las llaves, luego /token/customer con Bearer; devuelve la referencia', async () => {
    const api = apiSimulada({
      '/login': LOGIN,
      '/token/customer': { success: true, data: { status: true, data: { customerId: 'DiYPdhgncppes9KAb' } } },
    })
    const r = await registrarClienteEpayco(
      {
        cardTokenId: 'XCX92PZqBKfmcWFbA',
        pagador: { tipoDocumento: 'NIT', documento: '900123456', nombre: 'Ana', apellido: 'Pérez', email: 'ana@cda.co', celular: '3001234567' },
      },
      { env: ENV_TOKEN, fetch: api.f },
    )
    expect(r).toEqual({ ok: true, ref: 'epayco:DiYPdhgncppes9KAb:XCX92PZqBKfmcWFbA', customerId: 'DiYPdhgncppes9KAb' })
    expect(api.llamadas[0].url).toBe('https://apify.epayco.co/login')
    expect((api.llamadas[0].init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('pub_123:priv_456').toString('base64')}`,
    )
    expect(api.llamadas[1].url).toBe('https://apify.epayco.co/token/customer')
    expect((api.llamadas[1].init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-de-prueba')
    const cuerpo = JSON.parse(String(api.llamadas[1].init.body))
    expect(cuerpo).toMatchObject({ docType: 'NIT', docNumber: '900123456', requireCardToken: true, cardTokenId: 'XCX92PZqBKfmcWFbA' })
    // Ni un dato de tarjeta viaja desde ONE: solo el token.
    expect(JSON.stringify(api.llamadas)).not.toMatch(/cardNumber|cardCvc|cardExp/)
  })
  it('un token con forma rara no se manda', async () => {
    const api = apiSimulada({ '/login': LOGIN })
    const r = await registrarClienteEpayco(
      { cardTokenId: '4575 6231 8229 0326', pagador: { tipoDocumento: 'NIT', documento: '9', nombre: 'a', apellido: 'b', email: 'c', celular: 'd' } },
      { env: ENV_TOKEN, fetch: api.f },
    )
    expect(r.ok).toBe(false)
    expect(api.llamadas).toHaveLength(0)
  })
})

describe('cobrar con el token', () => {
  const solicitud = {
    referencia: 'ONE-0123456789abcdef0123456789abcdef-1760000000000',
    suscripcionId: '',
    workspaceId: 'ws',
    cobroId: '01234567-89ab-cdef-0123-456789abcdef',
    planCobroId: 'p',
    numeroCuota: 1,
    monto: 150000,
    moneda: 'COP' as const,
    descripcion: 'Suscripción Valida — periodo del 12-oct al 11-nov',
    facturaRef: null,
    medioPago: { tipo: 'tarjeta' as const, token_ref: 'epayco:DiYPdhgncppes9KAb:XCX92PZqBKfmcWFbA' },
    cliente: null,
    pagador: { tipoDocumento: 'NIT', documento: '900123456', nombre: 'CDA', apellido: '.', email: 'ana@cda.co', celular: '3001234567' },
  }
  const tx = (estado: string, extra: Record<string, unknown> = {}) => ({
    success: true,
    data: { transaction: { status: true, data: { ref_payco: 7363332, estado, respuesta: estado, valor: '150000', fecha: '2026-10-12 11:11:19', cod_respuesta: 1, ...extra } } },
  })

  it('aceptada → aprobado, con la referencia de ePayco y modo prueba', async () => {
    const api = apiSimulada({ '/login': LOGIN, '/payment/process': tx('Aceptada') })
    const r = await cobrarConTokenEpayco(solicitud, { env: ENV_TOKEN, fetch: api.f })
    expect(r).toEqual({ estado: 'aprobado', externalRef: 'epayco-7363332', fecha: '2026-10-12', monto: 150000 })
    const cuerpo = JSON.parse(String(api.llamadas[1].init.body))
    expect(cuerpo).toMatchObject({
      value: '150000',
      currency: 'COP',
      dues: '1',
      cardTokenId: 'XCX92PZqBKfmcWFbA',
      customerId: 'DiYPdhgncppes9KAb',
      invoice: solicitud.referencia,
      testMode: true,
      // Con `?ref=`: la confirmación vuelve al cobro aunque ePayco no mande `x_id_invoice`.
      urlConfirmation: `https://metrikone.co/api/webhooks/epayco?ref=${solicitud.referencia}`,
    })
  })
  it('pendiente y rechazada', async () => {
    const pend = apiSimulada({ '/login': LOGIN, '/payment/process': tx('Pendiente') })
    expect((await cobrarConTokenEpayco(solicitud, { env: ENV_TOKEN, fetch: pend.f })).estado).toBe('pendiente')
    const rech = apiSimulada({ '/login': LOGIN, '/payment/process': tx('Rechazada', { respuesta: 'Fondos insuficientes', cod_respuesta: 2 }) })
    expect(await cobrarConTokenEpayco(solicitud, { env: ENV_TOKEN, fetch: rech.f })).toMatchObject({ estado: 'rechazado', mensaje: 'Fondos insuficientes' })
  })
  it('sin tarjeta guardada no llama a ePayco', async () => {
    const api = apiSimulada({ '/login': LOGIN })
    const r = await cobrarConTokenEpayco({ ...solicitud, medioPago: null }, { env: ENV_TOKEN, fetch: api.f })
    expect(r).toMatchObject({ estado: 'rechazado', codigo: 'sin_medio_pago' })
    expect(api.llamadas).toHaveLength(0)
  })
  it('el adaptador exige los datos del pagador', async () => {
    const a = crearAdapterEpayco({ env: ENV_TOKEN, fetch: apiSimulada({}).f })
    expect(await a.cobrar({ ...solicitud, cliente: null })).toMatchObject({ estado: 'error' })
  })
  it('estados de ePayco', () => {
    expect(resultadoDeEstado('Aceptada')).toBe('aprobado')
    expect(resultadoDeEstado('Pendiente')).toBe('pendiente')
    expect(resultadoDeEstado('Fallida')).toBe('rechazado')
    expect(resultadoDeEstado(undefined)).toBe('rechazado')
  })
})

describe('la confirmación (webhook)', () => {
  const base = {
    x_ref_payco: '7363332',
    x_transaction_id: '48771657326867',
    x_amount: '150000',
    x_currency_code: 'COP',
    x_cod_transaction_state: '1',
    x_transaction_state: 'Aceptada',
    x_id_invoice: 'ONE-0123456789abcdef0123456789abcdef-1760000000000',
    x_transaction_date: '2026-10-12 11:11:19',
    x_test_request: 'TRUE',
  }
  const firmado = (c: Record<string, string>) => ({ ...c, x_signature: firmaConfirmacion(c, '901234', 'pkey_789') })
  const form = (c: Record<string, string>) => new URLSearchParams(c).toString()

  it('la firma es sha256(cust^pkey^ref^tx^monto^moneda), como la documenta ePayco', () => {
    const esperada = createHash('sha256').update('901234^pkey_789^7363332^48771657326867^150000^COP').digest('hex')
    expect(firmaConfirmacion(base, '901234', 'pkey_789')).toBe(esperada)
  })

  it('aceptada y firmada → evento aprobado con la referencia de ONE', () => {
    const v = verificarConfirmacionEpayco(form(firmado(base)), ENV_TOKEN)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.evento).toMatchObject({
      tipo: 'aprobado',
      eventoId: '7363332-1',
      referenciaPago: 'epayco-7363332',
      referencia: base.x_id_invoice,
      transaccionId: '7363332',
      monto: 150000,
      moneda: 'COP',
      ocurridoAt: '2026-10-12T12:00:00-05:00',
    })
    // La firma no se guarda en la bandeja de eventos.
    expect(JSON.stringify(v.evento.crudo)).not.toContain(firmado(base).x_signature)
  })

  it('con la referencia en `?ref=` y en `x_id_invoice`, manda la de la URL', () => {
    const crudo = cuerpoConfirmacionEpayco(form(firmado(base)), 'application/x-www-form-urlencoded', new URLSearchParams({ ref: 'ONE-ref-de-la-url' }))
    const v = verificarConfirmacionEpayco(crudo, ENV_TOKEN)
    expect(v.ok && v.evento.referencia).toBe('ONE-ref-de-la-url')
  })

  it('llega igual como JSON o en la URL', () => {
    expect(verificarConfirmacionEpayco(JSON.stringify(firmado(base)), ENV_TOKEN).ok).toBe(true)
    expect(verificarConfirmacionEpayco(`?${form(firmado(base))}`, ENV_TOKEN).ok).toBe(true)
    expect(camposConfirmacion('')).toBeNull()
  })

  it('firma ajena, sin firma o sin llaves no pasa', () => {
    expect(verificarConfirmacionEpayco(form({ ...base, x_signature: 'a'.repeat(64) }), ENV_TOKEN)).toEqual({ ok: false, motivo: 'firma_invalida' })
    expect(verificarConfirmacionEpayco(form(base), ENV_TOKEN)).toEqual({ ok: false, motivo: 'sin_firma' })
    expect(verificarConfirmacionEpayco(form(firmado(base)), {})).toEqual({ ok: false, motivo: 'no_configurado' })
    // Un monto cambiado después de firmar rompe la firma.
    expect(verificarConfirmacionEpayco(form({ ...firmado(base), x_amount: '1' }), ENV_TOKEN)).toEqual({ ok: false, motivo: 'firma_invalida' })
  })

  it('un pago de PRUEBA nunca registra plata fuera de modo prueba ni en el despliegue de producción', () => {
    const enProd = verificarConfirmacionEpayco(form(firmado(base)), { ...ENV_TOKEN, VERCEL_ENV: 'production' })
    expect(enProd.ok && enProd.evento.tipo).toBe('otro')
    const real = verificarConfirmacionEpayco(form(firmado(base)), { ...ENV_TOKEN, EPAYCO_PRODUCCION: '1' })
    expect(real.ok && real.evento.tipo).toBe('otro')
  })

  it('estados: rechazada, reversada, pendiente', () => {
    const t = (cod: string) => {
      const v = verificarConfirmacionEpayco(form(firmado({ ...base, x_cod_transaction_state: cod })), ENV_TOKEN)
      return v.ok ? v.evento.tipo : null
    }
    expect(t('2')).toBe('rechazado')
    expect(t('6')).toBe('anulado')
    expect(t('3')).toBe('otro')
  })
})

describe('borrar la tarjeta al cancelar (7.3)', () => {
  const REF = 'epayco:cDrjtT6J3NXgkorWB:XCX92PZqBKfmcWFbA'
  const CLIENTE = {
    success: true,
    data: { data: { id_customer: 'cDrjtT6J3NXgkorWB', cards: [{ token: '**********FqctY4', franchise: 'visa', mask: '************0326' }] } },
  }
  const BORRADO = { success: true, textResponse: 'Success token delete', data: { status: true } }

  it('consulta el cliente y borra cada tarjeta con su franquicia y su máscara', async () => {
    const api = apiSimulada({ '/login': LOGIN, '/subscriptions/customer': CLIENTE, '/subscription/token/card/delete': BORRADO })
    const r = await eliminarTarjetasEpayco(REF, { env: ENV_TOKEN, fetch: api.f })
    expect(r).toEqual({ ok: true, borradas: 1 })
    const borrado = api.llamadas.find((l) => l.url.endsWith('/subscription/token/card/delete'))
    expect(JSON.parse(String(borrado?.init.body))).toEqual({ franchise: 'visa', mask: '************0326', customerId: 'cDrjtT6J3NXgkorWB' })
    expect((borrado?.init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-de-prueba')
  })

  it('sin tarjetas que borrar (ya se borraron) es éxito', async () => {
    const api = apiSimulada({ '/login': LOGIN, '/subscriptions/customer': { success: true, data: { data: { cards: [] } } } })
    expect(await eliminarTarjetasEpayco(REF, { env: ENV_TOKEN, fetch: api.f })).toEqual({ ok: true, borradas: 0 })
  })

  it('si ePayco no borra, no dice que borró', async () => {
    const api = apiSimulada({ '/login': LOGIN, '/subscriptions/customer': CLIENTE, '/subscription/token/card/delete': { success: false, textResponse: 'Error' } })
    expect((await eliminarTarjetasEpayco(REF, { env: ENV_TOKEN, fetch: api.f })).ok).toBe(false)
  })

  it('una referencia que no es de ePayco, o sin llaves, no llama a nadie', async () => {
    const api = apiSimulada({ '/login': LOGIN })
    expect((await eliminarTarjetasEpayco('bold:x', { env: ENV_TOKEN, fetch: api.f })).ok).toBe(false)
    expect((await eliminarTarjetasEpayco(REF, { env: {}, fetch: api.f })).ok).toBe(false)
    expect(api.llamadas).toHaveLength(0)
  })
})
