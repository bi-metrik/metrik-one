/**
 * El método de pago al registrarse y el cobro con la tarjeta guardada, con ePayco simulado.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import type { PasarelaAdapter, ResultadoCargo, SolicitudCargo } from '@/lib/suscripciones/pasarela/adapter'
import type { EventoPasarela } from '@/lib/suscripciones/pasarela/adapter'
import { leerTarjeta, partirNombre, pideMetodoPago } from './metodo-pago'

const eventos: EventoPasarela[] = []
vi.mock('@/lib/cobros/pago-en-linea', () => ({
  procesarEventoPasarela: async (e: EventoPasarela) => {
    eventos.push(e)
    return { resultado: 'registrado', detalle: 'Pago registrado.', cobroId: 'x' }
  },
}))
vi.mock('@/lib/cobros/pago-en-linea-servidor', () => ({ repoPagoEnLinea: () => ({}) }))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => undefined }))

const { cobrarCuotaConTarjeta, cobrarCuotasConTarjeta, pasarElPlanATarjeta } = await import('./cobro-token-servidor')

describe('el método de pago al registrarse', () => {
  it('solo con la cláusula de cobro vigente Y ePayco encendido', () => {
    expect(pideMetodoPago(false, { EPAYCO_HABILITADO: '1' })).toBe(false)
    expect(pideMetodoPago(true, {})).toBe(false)
    expect(pideMetodoPago(true, { EPAYCO_HABILITADO: '1' })).toBe(true)
  })
  it('del navegador llega el token, el titular y un celular; nada más se acepta', () => {
    expect(leerTarjeta({ token: 'XCX92PZqBKfmcWFbA', titular: ' Ana  María Pérez ', celular: '300 123 4567' })).toEqual({
      ok: true,
      tarjeta: { token: 'XCX92PZqBKfmcWFbA', titular: 'Ana María Pérez', celular: '3001234567' },
    })
    expect(leerTarjeta({ token: '4575623182290326 123', titular: 'Ana', celular: '3001234567' })).toEqual({ ok: false, problema: 'token' })
    expect(leerTarjeta({ token: 'XCX92PZqBKfmcWFbA', titular: 'A', celular: '3001234567' })).toEqual({ ok: false, problema: 'titular' })
    expect(leerTarjeta({ token: 'XCX92PZqBKfmcWFbA', titular: 'Ana', celular: '6011234567' })).toEqual({ ok: false, problema: 'celular' })
    expect(leerTarjeta(undefined)).toEqual({ ok: false, problema: 'sin_tarjeta' })
  })
  it('nombre y apellido para ePayco', () => {
    expect(partirNombre('Ana María Pérez')).toEqual({ nombre: 'Ana', apellido: 'María Pérez' })
    expect(partirNombre('Ana')).toEqual({ nombre: 'Ana', apellido: 'Ana' })
  })
})

const METRIK = 'ws-metrik'
const PAGADOR = 'ws-cda'
const REF = 'epayco:DiYPdhgncppes9KAb:XCX92PZqBKfmcWFbA'

function base(extra: Partial<Tablas> = {}): Tablas {
  return {
    servicios_contratados: [{ id: 'sc', workspace_id: METRIK, negocio_id: 'n1', estado: 'activo', workspace_pagador_id: PAGADOR }],
    workspaces: [{ id: PAGADOR, config_extra: { origen_registro: 'valida_autogestion', valida_pagador: { celular: '3001234567' } } }],
    valida_registros: [
      { workspace_id: PAGADOR, estado: 'creado', metodo_pago_estado: 'registrado', metodo_pago_ref: REF, correo: 'ana@cda.co', identificacion: '900123456', razon_social: 'CDA EJEMPLO S.A.S.' },
    ],
    planes_cobro: [{ id: 'p1', workspace_id: METRIK, negocio_id: 'n1', pasarela: 'epayco', total_cuotas: 12 }],
    plan_cobro_cuotas: [
      { id: 'q1', workspace_id: METRIK, plan_cobro_id: 'p1', numero: 1, monto: 150000, fecha_vencimiento: '2026-10-12', concepto_detalle: 'Suscripción Valida · periodo del 12-oct al 11-nov' },
      { id: 'q2', workspace_id: METRIK, plan_cobro_id: 'p1', numero: 2, monto: 150000, fecha_vencimiento: '2026-11-12', concepto_detalle: 'Suscripción Valida · periodo del 12-nov al 11-dic' },
    ],
    cobros: [],
    ...extra,
  }
}

function epayco(resultado: ResultadoCargo) {
  const cargos: SolicitudCargo[] = []
  const adapter = {
    nombre: 'epayco',
    capacidades: { cobroSinClic: true, tokenizacion: true, linkDePago: false, webhook: true },
    cobrar: async (s: SolicitudCargo) => {
      cargos.push(s)
      return resultado
    },
    consultar: async () => resultado,
  } as unknown as PasarelaAdapter
  return { adapterPara: (p: string) => (p === 'epayco' ? adapter : null), cargos }
}

const AHORA = Date.parse('2026-10-12T15:00:00Z')

beforeEach(() => {
  eventos.length = 0
})

describe('cobrar una cuota con la tarjeta', () => {
  it('aprobado: crea el cobro programado, cobra con el token y registra por el camino del webhook', async () => {
    const d = crearDoble(base())
    const e = epayco({ estado: 'aprobado', externalRef: 'epayco-7363332', fecha: '2026-10-12', monto: 150000 })
    const r = await cobrarCuotaConTarjeta({ db: d.db, adapterPara: e.adapterPara, ahoraMs: AHORA }, { cobradorId: METRIK, cuotaId: 'q1' })
    expect(r.tipo).toBe('aprobado')
    expect(d.tablas.cobros).toHaveLength(1)
    expect(d.tablas.cobros[0]).toMatchObject({ tipo_cobro: 'programado', fecha: null, monto: 150000, numero_cuota: 1, plan_cobro_id: 'p1' })
    expect(e.cargos[0]).toMatchObject({
      monto: 150000,
      medioPago: { tipo: 'tarjeta', token_ref: REF, pasarela: 'epayco' },
      cliente: { documento: '900123456', tipoDocumento: 'NIT', email: 'ana@cda.co', celular: '3001234567' },
    })
    // La referencia de ONE (`referenciaEnlaceCobro`): con ella la confirmación vuelve al cobro.
    expect(e.cargos[0].referencia).toBe(`ONE-${String(d.tablas.cobros[0].id).replace(/-/g, '')}-${AHORA}`)
    expect(eventos[0]).toMatchObject({ tipo: 'aprobado', referenciaPago: 'epayco-7363332', referencia: e.cargos[0].referencia, monto: 150000 })
    // Nunca un número de tarjeta en lo que se manda.
    expect(JSON.stringify(e.cargos)).not.toMatch(/cardNumber|cardCvc|card\[number\]|cvc/i)
  })

  it('una cuota pagada o con un cobro pendiente en ePayco no se vuelve a cobrar', async () => {
    const pagada = crearDoble(base({ cobros: [{ id: 'c1', workspace_id: METRIK, plan_cobro_id: 'p1', numero_cuota: 1, tipo_cobro: 'programado', fecha: '2026-10-12', anulado_at: null, external_ref: 'epayco-1' }] }))
    const e = epayco({ estado: 'aprobado', externalRef: 'epayco-2', fecha: '2026-10-12', monto: 150000 })
    expect((await cobrarCuotaConTarjeta({ db: pagada.db, adapterPara: e.adapterPara }, { cobradorId: METRIK, cuotaId: 'q1' })).tipo).toBe('pagada')
    const pendiente = crearDoble(base({ cobros: [{ id: 'c1', workspace_id: METRIK, plan_cobro_id: 'p1', numero_cuota: 1, tipo_cobro: 'programado', fecha: null, anulado_at: null, external_ref: 'epayco-1' }] }))
    expect((await cobrarCuotaConTarjeta({ db: pendiente.db, adapterPara: e.adapterPara }, { cobradorId: METRIK, cuotaId: 'q1' })).tipo).toBe('pendiente_previo')
    expect(e.cargos).toHaveLength(0)
  })

  it('pendiente: deja la referencia para que la cierre la confirmación', async () => {
    const d = crearDoble(base())
    const e = epayco({ estado: 'pendiente', externalRef: 'epayco-99' })
    const r = await cobrarCuotaConTarjeta({ db: d.db, adapterPara: e.adapterPara, ahoraMs: AHORA }, { cobradorId: METRIK, cuotaId: 'q1' })
    expect(r.tipo).toBe('pendiente')
    expect(d.tablas.cobros[0].external_ref).toBe('epayco-99')
    expect(eventos).toHaveLength(0)
  })

  it('primer cobro (cuota 1) rechazado: cláusula 7.5, el plan vuelve a enlace (Bold) y no se reintenta', async () => {
    const d = crearDoble(base())
    const e = epayco({ estado: 'rechazado', externalRef: 'epayco-5', codigo: '2', mensaje: 'Fondos insuficientes', reintentable: false })
    const r = await cobrarCuotasConTarjeta({ db: d.db, adapterPara: e.adapterPara, hoy: '2026-10-12', ahoraMs: AHORA })
    expect(r.rechazadas).toBe(1)
    expect(e.cargos).toHaveLength(1)
    expect(d.tablas.planes_cobro[0].pasarela).toBe('bold')
    expect(d.tablas.cobro_intentos_tarjeta[0]).toMatchObject({ intento: 0, numero_cuota: 1, resultado: 'rechazado' })
    // La cuota 1 no tiene intentos de los días 3 y 7 (aunque el plan siguiera en la tarjeta).
    const otra = crearDoble(base())
    expect(await cobrarCuotaConTarjeta({ db: otra.db, adapterPara: e.adapterPara }, { cobradorId: METRIK, cuotaId: 'q1', intento: 1 })).toEqual({
      tipo: 'no_aplica',
      motivo: 'primer_cobro_sin_reintento',
    })
  })

  it('el cron solo mira cuotas vencidas o de hoy, y sin ePayco no hace nada', async () => {
    const d = crearDoble(base())
    const e = epayco({ estado: 'aprobado', externalRef: 'epayco-1', fecha: '2026-10-12', monto: 150000 })
    const r = await cobrarCuotasConTarjeta({ db: d.db, adapterPara: e.adapterPara, hoy: '2026-10-12', ahoraMs: AHORA })
    expect(r).toMatchObject({ revisadas: 1, aprobadas: 1 })
    const apagado = await cobrarCuotasConTarjeta({ db: crearDoble(base()).db, adapterPara: () => null, hoy: '2026-10-12' })
    expect(apagado.revisadas).toBe(0)
  })

  it('un espacio que no es del registro autogestionado (un CDA de hoy) no se cobra con tarjeta', async () => {
    const d = crearDoble(base({ workspaces: [{ id: PAGADOR, config_extra: { modo_vitrina: true } }] }))
    const e = epayco({ estado: 'aprobado', externalRef: 'epayco-1', fecha: '2026-10-12', monto: 150000 })
    const r = await cobrarCuotaConTarjeta({ db: d.db, adapterPara: e.adapterPara }, { cobradorId: METRIK, cuotaId: 'q1' })
    expect(r).toEqual({ tipo: 'no_aplica', motivo: 'sin_tarjeta' })
    expect(e.cargos).toHaveLength(0)
  })
})

describe('el plan nace por token si hay tarjeta', () => {
  it('bold → epayco con tarjeta; sin tarjeta no se toca', async () => {
    const con = crearDoble(base({ planes_cobro: [{ id: 'p1', workspace_id: METRIK, negocio_id: 'n1', pasarela: 'bold' }] }))
    expect(await pasarElPlanATarjeta({ db: con.db }, { cobradorId: METRIK, planCobroId: 'p1', ancla: { tipo: 'negocio', id: 'n1' } })).toBe(true)
    expect(con.tablas.planes_cobro[0].pasarela).toBe('epayco')
    const sin = crearDoble(
      base({
        planes_cobro: [{ id: 'p1', workspace_id: METRIK, negocio_id: 'n1', pasarela: 'bold' }],
        valida_registros: [{ workspace_id: PAGADOR, estado: 'creado', metodo_pago_estado: 'no_requerido', metodo_pago_ref: null, correo: 'a', identificacion: '1', razon_social: 'x' }],
      }),
    )
    expect(await pasarElPlanATarjeta({ db: sin.db }, { cobradorId: METRIK, planCobroId: 'p1', ancla: { tipo: 'negocio', id: 'n1' } })).toBe(false)
    expect(sin.tablas.planes_cobro[0].pasarela).toBe('bold')
  })
})

describe('una suscripción (suscripciones_producto) se cobra igual que un negocio', () => {
  const SUS = 'sus-1'
  function deSuscripcion(extra: Partial<Tablas> = {}): Tablas {
    return base({
      servicios_contratados: [{ id: 'sc', workspace_id: METRIK, negocio_id: null, suscripcion_id: SUS, estado: 'activo', workspace_pagador_id: PAGADOR }],
      suscripciones_producto: [
        {
          id: SUS,
          workspace_id: METRIK,
          workspace_cliente_id: PAGADOR,
          estado: 'activa',
          metodo_pago_pasarela: 'epayco',
          metodo_pago_ref: REF,
          correo_facturacion: 'facturas@cda.co',
          numero_documento: '900123456',
          razon_social: 'CDA EJEMPLO S.A.S.',
        },
      ],
      // El registro ya no es la fuente: la tarjeta es la de la suscripción.
      valida_registros: [],
      planes_cobro: [{ id: 'p1', workspace_id: METRIK, negocio_id: null, suscripcion_id: SUS, pasarela: 'epayco', total_cuotas: 12 }],
      ...extra,
    })
  }

  it('aprobado: el cobro cuelga de la suscripción (sin negocio) y el cargo usa la tarjeta y los datos de la suscripción', async () => {
    const d = crearDoble(deSuscripcion())
    const e = epayco({ estado: 'aprobado', externalRef: 'epayco-1', fecha: '2026-10-12', monto: 150000 })
    const r = await cobrarCuotaConTarjeta({ db: d.db, adapterPara: e.adapterPara, ahoraMs: AHORA }, { cobradorId: METRIK, cuotaId: 'q1' })
    expect(r.tipo).toBe('aprobado')
    expect(d.tablas.cobros[0]).toMatchObject({ negocio_id: null, suscripcion_id: SUS, plan_cobro_id: 'p1', numero_cuota: 1, fecha: null })
    expect(e.cargos[0]).toMatchObject({
      medioPago: { token_ref: REF },
      cliente: { documento: '900123456', email: 'facturas@cda.co', celular: '3001234567', nombre: 'CDA', apellido: 'EJEMPLO S.A.S.' },
    })
  })

  // 2026-10-16, cda-pruebas-futuras: el primer cargo con token de la historia respondió «Some fields are
  // required» (cobro_intentos_tarjeta, intento 0). La API simulada valida como ePayco: sin `ip`, sin
  // celular o con un apellido que no es apellido, no procesa. Sin el arreglo esta prueba falla.
  it('el cargo real de ePayco lleva la IP de la orden, el celular y nombre/apellido; si ePayco no lo procesa no culpa a la tarjeta', async () => {
    const { crearAdapterEpayco } = await import('@/lib/suscripciones/pasarela/epayco')
    const ENV = { EPAYCO_HABILITADO: '1', EPAYCO_PUBLIC_KEY_METRIK: 'pub', EPAYCO_PRIVATE_KEY_METRIK: 'priv', EPAYCO_P_CUST_ID_CLIENTE: '1', EPAYCO_P_KEY: 'k', VERCEL_ENV: 'preview' }
    const cuerpos: Record<string, unknown>[] = []
    const exigente = (async (url: string, init: RequestInit) => {
      const ruta = new URL(url).pathname
      if (ruta === '/login') return new Response(JSON.stringify({ token: 'jwt' }), { status: 200 })
      const c = JSON.parse(String(init.body)) as Record<string, string>
      cuerpos.push(c)
      const faltan = ['ip', 'cellPhone', 'lastName', 'docNumber', 'email', 'address'].filter((k) => !c[k] || !/[A-Za-z0-9]/.test(String(c[k])))
      if (faltan.length > 0) {
        return new Response(
          JSON.stringify({ success: false, textResponse: 'Some fields are required, please correct the errors and try again', data: { errors: faltan.map((f) => ({ codError: 'E001', errorMessage: `field ${f} required` })) } }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ success: true, data: { transaction: { data: { ref_payco: 77, estado: 'Aceptada', valor: '150000', fecha: '2026-10-16 11:35:40' } } } }), { status: 200 })
    }) as unknown as typeof fetch
    const adapter = crearAdapterEpayco({ env: ENV, fetch: exigente })
    const adapterPara = (p: string) => (p === 'epayco' ? adapter : null)

    const t = deSuscripcion()
    Object.assign(t.suscripciones_producto[0], { valida_registro_id: 'reg-1' })
    t.valida_registros = [{ id: 'reg-1', workspace_id: PAGADOR, estado: 'creado', ip: '186.155.120.92', cobro_confirmado_ip: '186.155.120.93' }]
    const d = crearDoble(t)
    const r = await cobrarCuotaConTarjeta({ db: d.db, adapterPara, ahoraMs: AHORA }, { cobradorId: METRIK, cuotaId: 'q1' })
    expect(r.tipo).toBe('aprobado')
    // La IP de la confirmación (la orden de cobro) manda sobre la del registro.
    expect(cuerpos[0]).toMatchObject({ ip: '186.155.120.93', country: 'CO', name: 'CDA', lastName: 'EJEMPLO S.A.S.', cellPhone: '3001234567', docNumber: '900123456' })

    // Sin celular ni IP: ePayco no lo procesa. Es un error nuestro, no un rechazo del banco: el intento
    // queda en `error`, sin enlace automático, la bitácora lo dice y el plan sigue en la tarjeta.
    const sinDatos = deSuscripcion({ workspaces: [{ id: PAGADOR, config_extra: { origen_registro: 'valida_autogestion' } }] })
    const d2 = crearDoble(sinDatos)
    const r2 = await cobrarCuotaConTarjeta({ db: d2.db, adapterPara, ahoraMs: AHORA }, { cobradorId: METRIK, cuotaId: 'q1' })
    expect(r2).toMatchObject({ tipo: 'no_procesado' })
    expect(d2.tablas.cobro_intentos_tarjeta[0]).toMatchObject({ resultado: 'error', numero_cuota: 1, intento: 0 })
    expect(d2.tablas.planes_cobro[0].pasarela).toBe('epayco')
    expect(d2.tablas.suscripciones_producto_eventos).toEqual([expect.objectContaining({ tipo: 'cobro_tarjeta_no_procesado' })])
  })

  it('ePayco responde que faltan campos: el motivo llega con el campo que pidió', async () => {
    const { crearAdapterEpayco } = await import('@/lib/suscripciones/pasarela/epayco')
    const ENV = { EPAYCO_HABILITADO: '1', EPAYCO_PUBLIC_KEY_METRIK: 'pub', EPAYCO_PRIVATE_KEY_METRIK: 'priv', EPAYCO_P_CUST_ID_CLIENTE: '1', EPAYCO_P_KEY: 'k', VERCEL_ENV: 'preview' }
    const f = (async (url: string) =>
      new URL(url).pathname === '/login'
        ? new Response(JSON.stringify({ token: 'jwt' }), { status: 200 })
        : new Response(JSON.stringify({ success: false, textResponse: 'Some fields are required, please correct the errors and try again', data: { totalErrors: 1, errors: [{ codError: 'E002', errorMessage: 'field city required' }] } }), { status: 200 })) as unknown as typeof fetch
    const adapter = crearAdapterEpayco({ env: ENV, fetch: f })
    const t = deSuscripcion()
    const d = crearDoble(t)
    const r = await cobrarCuotaConTarjeta({ db: d.db, adapterPara: () => adapter, ahoraMs: AHORA }, { cobradorId: METRIK, cuotaId: 'q1' })
    expect(r.tipo).toBe('no_procesado')
    expect(d.tablas.cobro_intentos_tarjeta[0].mensaje).toContain('field city required')
  })

  it('rechazado: la línea va a la bitácora de la suscripción, no a un negocio', async () => {
    const d = crearDoble(deSuscripcion())
    const e = epayco({ estado: 'rechazado', externalRef: 'epayco-5', codigo: '2', mensaje: 'Fondos insuficientes', reintentable: false })
    const r = await cobrarCuotaConTarjeta({ db: d.db, adapterPara: e.adapterPara, ahoraMs: AHORA }, { cobradorId: METRIK, cuotaId: 'q1' })
    expect(r.tipo).toBe('rechazado')
    expect(d.tablas.suscripciones_producto_eventos).toEqual([
      expect.objectContaining({ suscripcion_id: SUS, workspace_id: METRIK, tipo: 'cobro_tarjeta_rechazado' }),
    ])
    expect(d.tablas.planes_cobro[0].pasarela).toBe('bold')
  })

  it('una suscripción cancelada, de otro espacio o sin tarjeta no se cobra', async () => {
    const e = epayco({ estado: 'aprobado', externalRef: 'epayco-1', fecha: '2026-10-12', monto: 150000 })
    for (const cambio of [{ estado: 'cancelada' }, { workspace_cliente_id: 'otro' }, { metodo_pago_ref: null, metodo_pago_pasarela: null }]) {
      const t = deSuscripcion()
      Object.assign(t.suscripciones_producto[0], cambio)
      const r = await cobrarCuotaConTarjeta({ db: crearDoble(t).db, adapterPara: e.adapterPara }, { cobradorId: METRIK, cuotaId: 'q1' })
      expect(r, JSON.stringify(cambio)).toEqual({ tipo: 'no_aplica', motivo: 'sin_tarjeta' })
    }
    expect(e.cargos).toHaveLength(0)
  })

  it('el plan de la suscripción pasa a la tarjeta al nacer', async () => {
    const t = deSuscripcion()
    t.planes_cobro[0].pasarela = 'bold'
    const d = crearDoble(t)
    expect(await pasarElPlanATarjeta({ db: d.db }, { cobradorId: METRIK, planCobroId: 'p1', ancla: { tipo: 'suscripcion', id: SUS } })).toBe(true)
    expect(d.tablas.planes_cobro[0].pasarela).toBe('epayco')
  })
})
