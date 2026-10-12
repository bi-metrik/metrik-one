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

  it('rechazado: cláusula 7.5, el plan vuelve a enlace (Bold) y no se cobran las demás', async () => {
    const d = crearDoble(base({ plan_cobro_cuotas: [...base().plan_cobro_cuotas, { id: 'q0', workspace_id: METRIK, plan_cobro_id: 'p1', numero: 0, monto: 1, fecha_vencimiento: '2026-10-01', concepto_detalle: 'x' }] }))
    const e = epayco({ estado: 'rechazado', externalRef: 'epayco-5', codigo: '2', mensaje: 'Fondos insuficientes', reintentable: false })
    const r = await cobrarCuotasConTarjeta({ db: d.db, adapterPara: e.adapterPara, hoy: '2026-10-12', ahoraMs: AHORA })
    expect(r.rechazadas).toBe(1)
    expect(e.cargos).toHaveLength(1)
    expect(d.tablas.planes_cobro[0].pasarela).toBe('bold')
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
    expect(await pasarElPlanATarjeta({ db: con.db }, { cobradorId: METRIK, planCobroId: 'p1', negocioId: 'n1' })).toBe(true)
    expect(con.tablas.planes_cobro[0].pasarela).toBe('epayco')
    const sin = crearDoble(
      base({
        planes_cobro: [{ id: 'p1', workspace_id: METRIK, negocio_id: 'n1', pasarela: 'bold' }],
        valida_registros: [{ workspace_id: PAGADOR, estado: 'creado', metodo_pago_estado: 'no_requerido', metodo_pago_ref: null, correo: 'a', identificacion: '1', razon_social: 'x' }],
      }),
    )
    expect(await pasarElPlanATarjeta({ db: sin.db }, { cobradorId: METRIK, planCobroId: 'p1', negocioId: 'n1' })).toBe(false)
    expect(sin.tablas.planes_cobro[0].pasarela).toBe('bold')
  })
})
