import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { crearDoble, type Fila, type Tablas } from '../../../test/tablas-doble'
import type { PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import { cuentaDelContrato } from './aviso-suspendida-servidor'
import { carteraDe, MOTIVO_ANULACION_2_5 } from './cancelada'
import { cancelarSuscripcionesVencidas, enlaceDeReactivacionCda, NO_CANCELADA, reactivarCdaSiCorresponde } from './cancelada-servidor'
import { cuotasConEstado, proximoPago } from './pago-pendiente'

/**
 * El paso 8e del cron (la Cancelada guardada, Términos v1.5 11.3 y 2.5) y la reactivación (11.4), contra
 * tablas en memoria que se escriben de verdad (`crearDoble` aplica las guardas de cada update).
 */

const SLUG_DOC = 'terminos-suscripcion-valida-cda'
const BASE = 'Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS)'
const RS = 'CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA'

function tablas(extra: Partial<Tablas> = {}): Tablas {
  return {
    servicios_contratados: [
      {
        id: 'sc-caq',
        servicio_slug: 'valida-cda-licencia',
        estado: 'activo',
        cancelada_desde: null,
        reactivada_desde: null,
        reactivacion_cobro_id: null,
        workspace_id: 'ws-metrik',
        workspace_pagador_id: 'ws-caq',
        empresa_id: 'emp-caq',
        negocio_id: 'neg-caq',
        aceptante_designado_id: 'per-designada',
        parametros: { licencias: 2, precio_mensual: 150000 },
      },
      // El contrato viejo, cancelado, del mismo CDA (los 4 lo tienen): no se toca.
      { id: 'sc-viejo', servicio_slug: 'valida-cda-licencia', estado: 'cancelado', workspace_id: 'ws-metrik', workspace_pagador_id: 'ws-caq', empresa_id: 'emp-caq', negocio_id: 'neg-caq' },
    ],
    documentos_contractuales_versiones: [
      { slug: SLUG_DOC, version: 'v1.4', empresa_id: 'emp-caq', vigente_desde: '2026-11-06', rige_por_aviso: true, publicada_at: '2026-10-07T17:59:49Z' },
      { slug: SLUG_DOC, version: 'v1.5', empresa_id: 'emp-caq', vigente_desde: '2026-12-01', rige_por_aviso: true, publicada_at: '2026-11-01T05:00:00Z' },
    ],
    planes_cobro: [{ id: 'plan-caq', negocio_id: 'neg-caq', workspace_id: 'ws-metrik', fecha_inicio: '2026-09-23', auto_renovar: true, pasarela: 'bold', concepto_detalle_template: BASE }],
    plan_cobro_cuotas: [
      { id: 'q1', workspace_id: 'ws-metrik', plan_cobro_id: 'plan-caq', numero: 1, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-09-30', concepto_detalle: `${BASE} · periodo del 23-sep al 22-oct`, anulada_at: null },
      { id: 'q2', workspace_id: 'ws-metrik', plan_cobro_id: 'plan-caq', numero: 2, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-10-27', concepto_detalle: `${BASE} · periodo del 23-oct al 22-nov`, anulada_at: null },
      { id: 'q3', workspace_id: 'ws-metrik', plan_cobro_id: 'plan-caq', numero: 3, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-11-27', concepto_detalle: `${BASE} · periodo del 23-nov al 22-dic`, anulada_at: null },
      { id: 'q4', workspace_id: 'ws-metrik', plan_cobro_id: 'plan-caq', numero: 4, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-12-27', concepto_detalle: `${BASE} · periodo del 23-dic al 22-ene`, anulada_at: null },
    ],
    cobros: [
      { id: 'c1', tipo_cobro: 'programado', plan_cobro_id: 'plan-caq', numero_cuota: 1, negocio_id: 'neg-caq', monto: 150000, monto_anulado: null, anulado_at: null, fecha: '2026-10-02', retencion_iva: 0 },
      { id: 'c2', tipo_cobro: 'programado', plan_cobro_id: 'plan-caq', numero_cuota: 2, negocio_id: 'neg-caq', monto: 150000, monto_anulado: null, anulado_at: null, fecha: null, retencion_iva: 0 },
      // La cuota 4 con su enlace (nace el 20-dic): al anularse, el cobro se anula también.
      {
        id: 'c4', tipo_cobro: 'programado', plan_cobro_id: 'plan-caq', numero_cuota: 4, negocio_id: 'neg-caq', monto: 150000, monto_anulado: null, anulado_at: null, fecha: null, retencion_iva: 0,
        enlace_pago_url: 'https://checkout.bold.co/payment/LNK_Q4', enlace_pago_expira: '2026-12-27T12:00:00Z',
      },
    ],
    empresas: [{ id: 'emp-caq', nombre: 'CDA Caquetá', razon_social: RS, email_fiscal: 'Facturacion@CdaCaqueta.co ' }],
    workspaces: [
      { id: 'ws-caq', slug: 'cda-caqueta', name: 'CDA Caquetá' },
      { id: 'ws-metrik', slug: 'metrik', name: 'MéTRIK', config_extra: { cobros: { pasarela_en_linea: 'bold' } } },
    ],
    tarjetas_pago_cda: [],
    licencias_adicionales: [],
    avisos_cliente: [],
    activity_log: [],
    ...extra,
  }
}

function montar(t: Tablas, opts: { eliminar?: (ref: string) => Promise<{ ok: true; borradas: number } | { ok: false; error: string }> } = {}) {
  const d = crearDoble(t)
  const enviados: { to: string; subject: string; text: string; idempotencyKey: string }[] = []
  const eliminar = vi.fn(opts.eliminar ?? (async () => ({ ok: true as const, borradas: 1 })))
  return {
    ...d,
    enviados,
    eliminar,
    correr: (hoy: string) =>
      cancelarSuscripcionesVencidas({
        db: d.db,
        hoy,
        ahoraISO: `${hoy}T12:00:00Z`,
        correoDePersona: async (id) => (id === 'per-designada' ? 'gerencia@cdacaqueta.co' : null),
        urlPagos: (slug) => `https://${slug}.metrikone.co/suscripcion?tab=pagos`,
        eliminarTarjeta: eliminar,
        enviarCorreo: async (m) => {
          enviados.push(m)
          return { ok: true, id: `re_${enviados.length}` }
        },
      }),
  }
}

const sc = (t: Tablas) => (t.servicios_contratados as Fila[]).find((x) => x.id === 'sc-caq') as Fila
const q = (t: Tablas, id: string) => (t.plan_cobro_cuotas as Fila[]).find((x) => x.id === id) as Fila

describe('el día de la Cancelada en la transición (11.7): 31-dic', () => {
  it('el 30-dic (Suspendida) no pasa nada', async () => {
    const x = montar(tablas())
    const r = await x.correr('2026-12-30')
    expect(r.canceladas).toEqual([])
    expect(sc(x.tablas).estado).toBe('activo')
    expect(x.enviados).toEqual([])
    expect(x.escrituras).toEqual([])
  })

  it('el 31-dic: pausado + cancelada_desde, sin renovación, solo el período desde el 1-dic anulado, un correo por destino', async () => {
    const x = montar(tablas())
    const r = await x.correr('2026-12-31')
    expect(r.canceladas).toEqual([{ servicioContratadoId: 'sc-caq', canceladaDesde: '2026-12-31' }])
    expect(sc(x.tablas)).toMatchObject({ estado: 'pausado', cancelada_desde: '2026-12-31' })
    // D2: nunca terminado ni cancelado; el contrato viejo no se toca.
    expect((x.tablas.servicios_contratados as Fila[]).find((s) => s.id === 'sc-viejo')?.estado).toBe('cancelado')
    expect((x.tablas.planes_cobro as Fila[])[0].auto_renovar).toBe(false)
    // 2.5: la cuota del 23-dic se anula con su cobro; las de la transición se deben (11.7).
    expect(q(x.tablas, 'q4')).toMatchObject({ anulada_at: '2026-12-31T12:00:00Z', anulacion_motivo: MOTIVO_ANULACION_2_5 })
    for (const id of ['q1', 'q2', 'q3']) expect(q(x.tablas, id).anulada_at, id).toBe(null)
    const c4 = (x.tablas.cobros as Fila[]).find((c) => c.id === 'c4') as Fila
    expect(c4).toMatchObject({ monto: 0, monto_anulado: 150000, anulado_at: '2026-12-31T12:00:00Z' })
    const c2 = (x.tablas.cobros as Fila[]).find((c) => c.id === 'c2') as Fila
    expect(c2.anulado_at).toBe(null)
    expect(r.cuotasAnuladas).toEqual([{ servicioContratadoId: 'sc-caq', cuotaId: 'q4' }])
    // D8: el correo de facturación y la persona designada, sin repetir, con su fila en avisos_cliente.
    expect(x.enviados.map((m) => m.to).sort()).toEqual(['facturacion@cdacaqueta.co', 'gerencia@cdacaqueta.co'])
    const asunto = `Valida: la suscripción de ${RS} está Cancelada desde el 31 de diciembre de 2026`
    expect(x.enviados.every((m) => m.subject === asunto)).toBe(true)
    expect(x.enviados[0].text).toContain('del 23 de octubre al 22 de noviembre de 2026 ($150.000) y el período del 23 de noviembre al 22 de diciembre de 2026 ($150.000)')
    expect(x.enviados[0].text).toContain('no se cobran (cláusula 2.5)')
    expect(x.tablas.avisos_cliente).toHaveLength(2)
    expect((x.tablas.activity_log as Fila[]).length).toBeGreaterThan(0)
  })

  it('idempotente: otra corrida el mismo día y la del día siguiente no repiten nada', async () => {
    const x = montar(tablas())
    await x.correr('2026-12-31')
    const n = x.escrituras.length
    const r2 = await x.correr('2026-12-31')
    const r3 = await x.correr('2027-01-01')
    expect(x.enviados).toHaveLength(2)
    expect(r2.canceladas).toEqual([])
    expect(r2.cuotasAnuladas).toEqual([])
    expect(r3.yaAvisados).toBe(2)
    // Lo único que se reescribe es el apagado de la renovación, que ya no encuentra planes encendidos.
    expect(x.escrituras.slice(n).filter((e) => e.tabla !== 'planes_cobro')).toEqual([])
    expect(sc(x.tablas).cancelada_desde).toBe('2026-12-31')
  })

  it('si el cron no corrió el 31, la fecha guardada sigue siendo el 31 (no la de la corrida)', async () => {
    const x = montar(tablas())
    await x.correr('2027-01-03')
    expect(sc(x.tablas).cancelada_desde).toBe('2026-12-31')
  })

  it('con las dos cuotas de la transición pagadas el 30-dic, no se cancela', async () => {
    const t = tablas()
    ;(t.cobros as Fila[]).find((c) => c.id === 'c2')!.fecha = '2026-12-30'
    ;(t.cobros as Fila[]).push({ id: 'c3', tipo_cobro: 'programado', plan_cobro_id: 'plan-caq', numero_cuota: 3, negocio_id: 'neg-caq', monto: 150000, anulado_at: null, fecha: '2026-12-30', retencion_iva: 0 })
    const x = montar(t)
    const r = await x.correr('2026-12-31')
    expect(r.canceladas).toEqual([])
    expect(sc(x.tablas).estado).toBe('activo')
  })

  it('sin la v1.5 registrada no existe la Cancelada: no se toca', async () => {
    const t = tablas()
    t.documentos_contractuales_versiones = (t.documentos_contractuales_versiones as Fila[]).filter((d) => d.version !== 'v1.5')
    const x = montar(t)
    const r = await x.correr('2026-12-31')
    expect(r.omitidos).toEqual([{ servicioContratadoId: 'sc-caq', motivo: 'sin_v15' }])
    expect(sc(x.tablas).estado).toBe('activo')
  })
})

describe('el primer período v1.5 (23-dic): Cancelada el 23-ene-2027', () => {
  function alDiaHastaDiciembre(): Tablas {
    const t = tablas()
    ;(t.cobros as Fila[]).find((c) => c.id === 'c2')!.fecha = '2026-11-20'
    ;(t.cobros as Fila[]).push({ id: 'c3', tipo_cobro: 'programado', plan_cobro_id: 'plan-caq', numero_cuota: 3, negocio_id: 'neg-caq', monto: 150000, anulado_at: null, fecha: '2026-11-25', retencion_iva: 0 })
    // La cuota 5 nació antes de la mora (renovación del 28-nov): también es de un período desde el 1-dic.
    ;(t.plan_cobro_cuotas as Fila[]).push({ id: 'q5', workspace_id: 'ws-metrik', plan_cobro_id: 'plan-caq', numero: 5, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2027-01-27', concepto_detalle: `${BASE} · periodo del 23-ene al 22-feb`, anulada_at: null })
    return t
  }

  it('el 22-ene sigue Suspendida; el 23-ene queda Cancelada, se anulan la del 23-dic y la del 23-ene, sin cartera', async () => {
    const x = montar(alDiaHastaDiciembre())
    expect((await x.correr('2027-01-22')).canceladas).toEqual([])
    const r = await x.correr('2027-01-23')
    expect(r.canceladas).toEqual([{ servicioContratadoId: 'sc-caq', canceladaDesde: '2027-01-23' }])
    expect(r.cuotasAnuladas.map((c) => c.cuotaId).sort()).toEqual(['q4', 'q5'])
    expect(x.enviados[0].subject).toMatch(/Cancelada desde el 23 de enero de 2027$/)
    expect(x.enviados[0].text).not.toContain('11.7')
    expect(x.enviados[0].text).toContain('no se cobran (cláusula 2.5)')
  })
})

describe('la tarjeta (11.3): se cierra, se pide a ePayco borrarla y se avisa una vez', () => {
  const TARJETA = {
    id: 'tar-1', estado: 'activa', servicio_contratado_id: 'sc-caq', workspace_id: 'ws-metrik', workspace_cliente_id: 'ws-caq', negocio_id: 'neg-caq',
    plan_cobro_id: 'plan-caq', metodo_pago_ref: 'epayco:cus_1234:tok_5678', ultimos4: '4242', titular: {}, celular: '3001234567', correo: 'x@y.co',
    cobro_desde: '2026-11-04', dia_renovacion: 23, terminos_vigente_desde: '2026-12-01', ip: null, cerrada_at: null, cerrada_por: null, borrado_epayco: null,
  }

  it('cierra la tarjeta sin persona, devuelve el plan al enlace y manda su correo', async () => {
    const t = tablas({ tarjetas_pago_cda: [{ ...TARJETA }] })
    ;(t.planes_cobro as Fila[])[0].pasarela = 'epayco'
    const x = montar(t)
    const r = await x.correr('2026-12-31')
    expect(x.tablas.tarjetas_pago_cda[0]).toMatchObject({ estado: 'quitada', cerrada_por: null, borrado_epayco: 'ok' })
    expect((x.tablas.planes_cobro as Fila[])[0].pasarela).toBe('bold')
    expect(x.eliminar).toHaveBeenCalledTimes(1)
    expect(x.eliminar).toHaveBeenCalledWith('epayco:cus_1234:tok_5678')
    expect(r.tarjetasCerradas).toEqual([{ servicioContratadoId: 'sc-caq', borradoEpayco: true }])
    const tarjeta = x.enviados.filter((m) => m.subject.includes('tarjeta terminada en 4242'))
    expect(tarjeta.map((m) => m.to).sort()).toEqual(['facturacion@cdacaqueta.co', 'gerencia@cdacaqueta.co'])
  })

  it('idempotente: con el borrado hecho, otra corrida no vuelve a llamar a ePayco ni a escribir', async () => {
    const x = montar(tablas({ tarjetas_pago_cda: [{ ...TARJETA }] }))
    await x.correr('2026-12-31')
    await x.correr('2027-01-01')
    expect(x.eliminar).toHaveBeenCalledTimes(1)
    expect(x.enviados.filter((m) => m.subject.includes('tarjeta'))).toHaveLength(2)
  })

  it('si ePayco falla, se reintenta al día siguiente; el correo (que afirma el pedido) sale una sola vez', async () => {
    let falla = true
    const x = montar(tablas({ tarjetas_pago_cda: [{ ...TARJETA }] }), {
      eliminar: async () => (falla ? { ok: false, error: 'epayco 500' } : { ok: true, borradas: 1 }),
    })
    await x.correr('2026-12-31')
    expect(x.tablas.tarjetas_pago_cda[0].borrado_epayco).toBe('error: epayco 500')
    falla = false
    await x.correr('2027-01-01')
    expect(x.tablas.tarjetas_pago_cda[0].borrado_epayco).toBe('ok')
    expect(x.eliminar).toHaveBeenCalledTimes(2)
    expect(x.enviados.filter((m) => m.subject.includes('tarjeta'))).toHaveLength(2)
  })

  it('una tarjeta que quitó la persona antes (cerrada_por con su id) no se toca ni se avisa', async () => {
    const x = montar(tablas({ tarjetas_pago_cda: [{ ...TARJETA, estado: 'quitada', cerrada_por: 'per-designada', cerrada_at: '2026-12-31T13:00:00Z', borrado_epayco: 'error: x' }] }))
    await x.correr('2026-12-31')
    expect(x.eliminar).not.toHaveBeenCalled()
    expect(x.enviados.filter((m) => m.subject.includes('tarjeta'))).toEqual([])
  })
})

function pasarelaFalsa() {
  let n = 0
  const crear = vi.fn(async (s: { cobroId: string; monto: number; expiraMs: number }) => ({
    ok: true as const,
    idEnlace: `LNK_${++n}`,
    url: `https://checkout.bold.co/payment/LNK_${n}`,
    expira: new Date(s.expiraMs).toISOString(),
  }))
  const adapter = { id: 'bold', crearEnlacePago: crear, faltaConfiguracion: () => null } as unknown as PasarelaAdapter
  return { crear, adapterPara: (x: string) => (x === 'bold' ? adapter : null) }
}

describe('la reactivación (11.4): un período, la fecha del pago, sin tocar la cartera', () => {
  async function cancelada() {
    const x = montar(tablas())
    await x.correr('2026-12-31')
    return x
  }

  it('el enlace cobra exactamente un período (más los usuarios adicionales vigentes), sin plan, y se reusa mientras esté vigente', async () => {
    const x = await cancelada()
    ;(x.tablas.licencias_adicionales as Fila[]).push({ id: 'la1', servicio_contratado_id: 'sc-caq', valor_mensual: 50000, fecha_retiro: null })
    const p = pasarelaFalsa()
    const ahoraMs = Date.parse('2027-01-10T15:00:00Z')
    const r = await enlaceDeReactivacionCda({ contratoId: 'sc-caq', workspacePagadorId: 'ws-caq' }, { db: x.db, adapterPara: p.adapterPara, ahoraMs })
    expect(r).toEqual({ ok: true, url: 'https://checkout.bold.co/payment/LNK_1' })
    const id = sc(x.tablas).reactivacion_cobro_id as string
    const cobro = (x.tablas.cobros as Fila[]).find((c) => c.id === id) as Fila
    expect(cobro).toMatchObject({ plan_cobro_id: null, numero_cuota: null, monto: 200000, fecha: null, tipo_cobro: 'programado', negocio_id: 'neg-caq' })
    expect(p.crear.mock.calls[0][0].monto).toBe(200000)
    const r2 = await enlaceDeReactivacionCda({ contratoId: 'sc-caq', workspacePagadorId: 'ws-caq' }, { db: x.db, adapterPara: p.adapterPara, ahoraMs: ahoraMs + 60_000 })
    expect(r2).toEqual(r)
    expect(p.crear).toHaveBeenCalledTimes(1)
  })

  it('sin Cancelada, o desde otro espacio, no hay enlace', async () => {
    const x = montar(tablas())
    const p = pasarelaFalsa()
    expect(await enlaceDeReactivacionCda({ contratoId: 'sc-caq', workspacePagadorId: 'ws-caq' }, { db: x.db, adapterPara: p.adapterPara })).toEqual({ ok: false, error: NO_CANCELADA })
    const y = await cancelada()
    expect(await enlaceDeReactivacionCda({ contratoId: 'sc-caq', workspacePagadorId: 'ws-otro' }, { db: y.db, adapterPara: p.adapterPara })).toEqual({ ok: false, error: NO_CANCELADA })
    expect(p.crear).not.toHaveBeenCalled()
  })

  it('al pagarse: plan nuevo desde el día del pago, contrato activo, el pago cubre el período nuevo y la cartera sigue intacta', async () => {
    const x = await cancelada()
    const p = pasarelaFalsa()
    await enlaceDeReactivacionCda({ contratoId: 'sc-caq', workspacePagadorId: 'ws-caq' }, { db: x.db, adapterPara: p.adapterPara, ahoraMs: Date.parse('2027-01-10T15:00:00Z') })
    const id = sc(x.tablas).reactivacion_cobro_id as string
    // Antes de pagarse no pasa nada.
    expect(await reactivarCdaSiCorresponde(x.db, id)).toBe(null)
    ;(x.tablas.cobros as Fila[]).find((c) => c.id === id)!.fecha = '2027-01-10'

    const r = await reactivarCdaSiCorresponde(x.db, id)
    expect(r).toMatchObject({ revisar: false, reactivada: '2027-01-10' })
    expect(sc(x.tablas)).toMatchObject({ estado: 'activo', cancelada_desde: null, reactivada_desde: '2027-01-10' })
    const nuevo = (x.tablas.planes_cobro as Fila[]).find((pl) => pl.fecha_inicio === '2027-01-10') as Fila
    expect(nuevo).toMatchObject({ auto_renovar: true, activo: false, fecha_fin: '2027-02-09', pasarela: 'bold', negocio_id: 'neg-caq' })
    expect((x.tablas.plan_cobro_cuotas as Fila[]).find((c) => c.plan_cobro_id === nuevo.id)).toMatchObject({
      numero: 1,
      fecha_vencimiento: '2027-01-10',
      monto: 150000,
      concepto_detalle: `${BASE} · periodo del 10-ene al 9-feb`,
    })
    expect((x.tablas.cobros as Fila[]).find((c) => c.id === id)).toMatchObject({ plan_cobro_id: nuevo.id, numero_cuota: 1 })

    // La mora mira solo el plan nuevo; la cartera (11.7) sigue con sus dos períodos, sin la cuota anulada.
    const cuenta = await cuentaDelContrato(x.db, sc(x.tablas) as never)
    if ('error' in cuenta) throw new Error(cuenta.error)
    expect(proximoPago({ cuotas: cuenta.cuotas, cobros: cuenta.cobros, hoy: '2027-01-11', ahoraISO: '2027-01-11T12:00:00Z' }).estado).toBe('al_dia')
    const viejas = cuotasConEstado({ ...cuenta.anterior, hoy: '2027-01-11', ahoraISO: '2027-01-11T12:00:00Z' })
    expect(carteraDe(viejas, '2026-12-01').map((c) => [c.numero, c.saldo])).toEqual([
      [2, 150000],
      [3, 150000],
    ])

    // Idempotente: el webhook repetido y el cron no crean otro plan.
    expect(await reactivarCdaSiCorresponde(x.db, id)).toBe(null)
    const r8e = await x.correr('2027-01-11')
    expect(r8e.reactivadas).toEqual([])
    expect((x.tablas.planes_cobro as Fila[]).filter((pl) => pl.fecha_inicio === '2027-01-10')).toHaveLength(1)
    // Y con el contrato activo y el plan nuevo al día, el paso 8e no lo vuelve a cancelar por la deuda vieja.
    expect(r8e.canceladas).toEqual([])
    expect(sc(x.tablas).estado).toBe('activo')
  })

  it('si el webhook no alcanzó, el paso 8e cierra la reactivación pagada', async () => {
    const x = await cancelada()
    const p = pasarelaFalsa()
    await enlaceDeReactivacionCda({ contratoId: 'sc-caq', workspacePagadorId: 'ws-caq' }, { db: x.db, adapterPara: p.adapterPara, ahoraMs: Date.parse('2027-01-10T15:00:00Z') })
    const id = sc(x.tablas).reactivacion_cobro_id as string
    ;(x.tablas.cobros as Fila[]).find((c) => c.id === id)!.fecha = '2027-01-10'
    const r = await x.correr('2027-01-11')
    expect(r.reactivadas).toEqual([{ servicioContratadoId: 'sc-caq', desde: '2027-01-10' }])
    expect(sc(x.tablas).estado).toBe('activo')
  })

  it('reactivada y otra vez sin pagar: la Cancelada se mide sobre el plan nuevo (10-feb + 31 = 13-mar)', async () => {
    const x = await cancelada()
    const p = pasarelaFalsa()
    await enlaceDeReactivacionCda({ contratoId: 'sc-caq', workspacePagadorId: 'ws-caq' }, { db: x.db, adapterPara: p.adapterPara, ahoraMs: Date.parse('2027-01-10T15:00:00Z') })
    const id = sc(x.tablas).reactivacion_cobro_id as string
    ;(x.tablas.cobros as Fila[]).find((c) => c.id === id)!.fecha = '2027-01-10'
    await reactivarCdaSiCorresponde(x.db, id)
    const nuevo = (x.tablas.planes_cobro as Fila[]).find((pl) => pl.fecha_inicio === '2027-01-10') as Fila
    ;(x.tablas.plan_cobro_cuotas as Fila[]).push({ id: 'n2', workspace_id: 'ws-metrik', plan_cobro_id: nuevo.id, numero: 2, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2027-02-10', concepto_detalle: `${BASE} · periodo del 10-feb al 9-mar`, anulada_at: null })
    expect((await x.correr('2027-03-12')).canceladas).toEqual([])
    const r = await x.correr('2027-03-13')
    expect(r.canceladas).toEqual([{ servicioContratadoId: 'sc-caq', canceladaDesde: '2027-03-13' }])
    // Se anula la del plan nuevo; la cartera de la transición sigue debiéndose.
    expect(r.cuotasAnuladas.map((c) => c.cuotaId)).toEqual(['n2'])
    for (const idq of ['q2', 'q3']) expect(q(x.tablas, idq).anulada_at).toBe(null)
  })
})
