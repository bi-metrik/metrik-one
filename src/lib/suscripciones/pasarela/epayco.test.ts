import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  camposConfirmacion,
  cobrarConTokenEpayco,
  crearAdapterEpayco,
  faltaConfiguracionEpayco,
  firmaConfirmacion,
  llavePublicaEpayco,
  leerRefMedioPagoEpayco,
  refMedioPagoEpayco,
  registrarClienteEpayco,
  resultadoDeEstado,
  verificarConfirmacionEpayco,
} from './epayco'

/**
 * ePayco en modo prueba, con la API simulada (no hay llaves todavía). Las formas de las peticiones y
 * respuestas son las de la colección oficial de APIFY y la documentación de confirmación.
 */

const ENV = {
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
    expect(faltaConfiguracionEpayco(ENV)).toBeNull()
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
    expect(faltaConfiguracionEpayco({ ...ENV, VERCEL_ENV: 'production' })).toMatch(/modo prueba/)
    expect(faltaConfiguracionEpayco({ ...ENV, VERCEL_ENV: 'production', EPAYCO_PRODUCCION: '1' })).toBeNull()
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
      { env: ENV, fetch: api.f },
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
      { env: ENV, fetch: api.f },
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
    const r = await cobrarConTokenEpayco(solicitud, { env: ENV, fetch: api.f })
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
      urlConfirmation: 'https://metrikone.co/api/webhooks/epayco',
    })
  })
  it('pendiente y rechazada', async () => {
    const pend = apiSimulada({ '/login': LOGIN, '/payment/process': tx('Pendiente') })
    expect((await cobrarConTokenEpayco(solicitud, { env: ENV, fetch: pend.f })).estado).toBe('pendiente')
    const rech = apiSimulada({ '/login': LOGIN, '/payment/process': tx('Rechazada', { respuesta: 'Fondos insuficientes', cod_respuesta: 2 }) })
    expect(await cobrarConTokenEpayco(solicitud, { env: ENV, fetch: rech.f })).toMatchObject({ estado: 'rechazado', mensaje: 'Fondos insuficientes' })
  })
  it('sin tarjeta guardada no llama a ePayco', async () => {
    const api = apiSimulada({ '/login': LOGIN })
    const r = await cobrarConTokenEpayco({ ...solicitud, medioPago: null }, { env: ENV, fetch: api.f })
    expect(r).toMatchObject({ estado: 'rechazado', codigo: 'sin_medio_pago' })
    expect(api.llamadas).toHaveLength(0)
  })
  it('el adaptador exige los datos del pagador', async () => {
    const a = crearAdapterEpayco({ env: ENV, fetch: apiSimulada({}).f })
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
    const v = verificarConfirmacionEpayco(form(firmado(base)), ENV)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.evento).toMatchObject({
      tipo: 'aprobado',
      eventoId: '7363332-1',
      referenciaPago: 'epayco-7363332',
      referencia: base.x_id_invoice,
      transaccionId: '48771657326867',
      monto: 150000,
      moneda: 'COP',
      ocurridoAt: '2026-10-12T11:11:19-05:00',
    })
    // La firma no se guarda en la bandeja de eventos.
    expect(JSON.stringify(v.evento.crudo)).not.toContain(firmado(base).x_signature)
  })

  it('llega igual como JSON o en la URL', () => {
    expect(verificarConfirmacionEpayco(JSON.stringify(firmado(base)), ENV).ok).toBe(true)
    expect(verificarConfirmacionEpayco(`?${form(firmado(base))}`, ENV).ok).toBe(true)
    expect(camposConfirmacion('')).toBeNull()
  })

  it('firma ajena, sin firma o sin llaves no pasa', () => {
    expect(verificarConfirmacionEpayco(form({ ...base, x_signature: 'a'.repeat(64) }), ENV)).toEqual({ ok: false, motivo: 'firma_invalida' })
    expect(verificarConfirmacionEpayco(form(base), ENV)).toEqual({ ok: false, motivo: 'sin_firma' })
    expect(verificarConfirmacionEpayco(form(firmado(base)), {})).toEqual({ ok: false, motivo: 'no_configurado' })
    // Un monto cambiado después de firmar rompe la firma.
    expect(verificarConfirmacionEpayco(form({ ...firmado(base), x_amount: '1' }), ENV)).toEqual({ ok: false, motivo: 'firma_invalida' })
  })

  it('un pago de PRUEBA nunca registra plata fuera de modo prueba ni en el despliegue de producción', () => {
    const enProd = verificarConfirmacionEpayco(form(firmado(base)), { ...ENV, VERCEL_ENV: 'production' })
    expect(enProd.ok && enProd.evento.tipo).toBe('otro')
    const real = verificarConfirmacionEpayco(form(firmado(base)), { ...ENV, EPAYCO_PRODUCCION: '1' })
    expect(real.ok && real.evento.tipo).toBe('otro')
  })

  it('estados: rechazada, reversada, pendiente', () => {
    const t = (cod: string) => {
      const v = verificarConfirmacionEpayco(form(firmado({ ...base, x_cod_transaction_state: cod })), ENV)
      return v.ok ? v.evento.tipo : null
    }
    expect(t('2')).toBe('rechazado')
    expect(t('6')).toBe('anulado')
    expect(t('3')).toBe('otro')
  })
})
