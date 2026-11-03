import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import type { PlanAbierto } from './plan'
import {
  cumplioTreintaDias,
  diaDeTerminacion,
  primerDiaCompleto,
  suspensionDelPlan,
  TERMINACION_30_DIAS_APROBADA,
  terminacionHabilitada,
} from './terminacion'
import { terminarSuspensionesVencidas, type DepsTerminacion } from './terminacion-servidor'
import { enlaceDeReactivacion, PLAN_TERMINADO } from './reactivacion-servidor'

// La cuota 2 vence el 13-nov; con 10 días de gracia la bolsa de la cuota 1 vence el 23-nov a la
// medianoche de Bogotá: desde ahí está suspendido por mora, y los 30 días se cumplen el 23-dic.
const VENCE = '2026-11-23T05:00:00.000Z'
const PREVIEW = { VERCEL_ENV: 'preview' }
const PRODUCCION = { VERCEL_ENV: 'production' }
const at = (iso: string) => Date.parse(iso)

const PLAN: PlanAbierto = {
  cliente_id: 'cli-valida',
  limite_mes: 3000,
  cobro_id: 'cobro-1',
  cuota_numero: 1,
  desde: '2026-10-13',
  hasta: '2026-11-12',
  vence_en: VENCE,
  abierto_at: '2026-10-13T15:00:00.000Z',
}

function tablas(plan: PlanAbierto = PLAN, extra: Partial<Tablas> = {}): Tablas {
  return {
    workspaces: [
      { id: 'ws-cli', slug: 'acme', config_extra: { origen_registro: 'valida_autogestion', valida_plan: plan } },
      // Un CDA de hoy: no es autogestionado, no se mira aunque su plan esté vencido.
      { id: 'ws-cda', slug: 'cda', config_extra: { valida_plan: { ...plan } } },
    ],
    servicios_contratados: [
      { id: 'sc-1', workspace_id: 'metrik', negocio_id: null, suscripcion_id: 'sus-1', servicio_slug: 'valida-autoservicio', estado: 'activo', workspace_pagador_id: 'ws-cli', vigente_hasta: null },
      { id: 'sc-cda', workspace_id: 'metrik', negocio_id: 'neg-cda', suscripcion_id: null, servicio_slug: 'valida-cda', estado: 'activo', workspace_pagador_id: 'ws-cda', vigente_hasta: null },
    ],
    catalogo_servicios: [
      { slug: 'valida-autoservicio', modulo: 'valida_consulta' },
      { slug: 'valida-cda', modulo: 'valida_consulta' },
    ],
    planes_cobro: [{ id: 'plan-1', workspace_id: 'metrik', negocio_id: null, suscripcion_id: 'sus-1', auto_renovar: true, activo: true, pasarela: 'epayco' }],
    plan_cobro_cuotas: [
      { id: 'q1', plan_cobro_id: 'plan-1', numero: 1, monto: 150000, fecha_vencimiento: '2026-10-13' },
      { id: 'q2', plan_cobro_id: 'plan-1', numero: 2, monto: 150000, fecha_vencimiento: '2026-11-13' },
      { id: 'q3', plan_cobro_id: 'plan-1', numero: 3, monto: 150000, fecha_vencimiento: '2026-12-13' },
    ],
    cobros: [
      { id: 'cobro-1', workspace_id: 'metrik', negocio_id: null, suscripcion_id: 'sus-1', plan_cobro_id: 'plan-1', numero_cuota: 1, fecha: '2026-10-13', anulado_at: null },
      { id: 'cobro-2', workspace_id: 'metrik', negocio_id: null, suscripcion_id: 'sus-1', plan_cobro_id: 'plan-1', numero_cuota: 2, fecha: null, anulado_at: null },
    ],
    suscripciones_producto: [
      { id: 'sus-1', workspace_id: 'metrik', estado: 'activa', cancelada_at: null, cancelacion_motivo: null, metodo_pago_ref: 'epayco:cus1:tok1', metodo_pago_pasarela: 'epayco' },
    ],
    suscripciones_producto_eventos: [],
    valida_registros: [
      {
        id: 'reg-1',
        workspace_id: 'ws-cli',
        estado: 'creado',
        correo: 'g@acme.co',
        razon_social: 'ACME S.A.S.',
        identificacion: '900123456',
        metodo_pago_ref: 'epayco:cus1:tok1',
        metodo_pago_estado: 'registrado',
        cobro_token_borrado_at: null,
      },
    ],
    ...extra,
  }
}

function escenario(t: Tablas, env: Record<string, string>, borrado: () => Promise<{ ok: true; borradas: number } | { ok: false; error: string }> = async () => ({ ok: true, borradas: 1 })) {
  const doble = crearDoble(t)
  const correos: { to: string; subject: string; text: string; idempotencyKey: string }[] = []
  const pedidosBorrado: string[] = []
  const deps = (ahora: string, envAhora: Record<string, string> = env): DepsTerminacion => ({
    db: doble.db,
    ahoraMs: at(ahora),
    env: envAhora,
    enviarCorreo: async (m) => (correos.push(m), { ok: true }),
    eliminarTarjeta: async (ref) => (pedidosBorrado.push(ref), borrado()),
  })
  const plan = () => (doble.tablas.workspaces[0].config_extra as { valida_plan: PlanAbierto }).valida_plan
  return { ...doble, correos, pedidosBorrado, deps, plan }
}

describe('cuándo se cumplen los 30 días (días calendario de Bogotá)', () => {
  it('la bolsa vence a la medianoche de Bogotá: ese día es el primero y termina 30 días después', () => {
    expect(primerDiaCompleto(VENCE)).toBe('2026-11-23')
    expect(diaDeTerminacion(VENCE)).toBe('2026-12-23')
  })

  it('el corte a mitad del día no cuenta ese día: el primero completo es el siguiente', () => {
    // 10-nov a las 15:00 de Bogotá.
    expect(primerDiaCompleto('2026-11-10T20:00:00.000Z')).toBe('2026-11-11')
    expect(diaDeTerminacion('2026-11-10T20:00:00.000Z')).toBe('2026-12-11')
  })

  it('el día es el de Bogotá, no el de UTC', () => {
    // 23:30 del 10-nov en Bogotá (04:30 UTC del 11): primer día completo el 11-nov.
    expect(primerDiaCompleto('2026-11-11T04:30:00.000Z')).toBe('2026-11-11')
    // 00:30 del 11-nov en Bogotá: ya empezó el 11, el primero completo es el 12.
    expect(primerDiaCompleto('2026-11-11T05:30:00.000Z')).toBe('2026-11-12')
  })

  it('el borde: las 23:59 del día 29 no; las 00:00 del día de la terminación sí', () => {
    const s = suspensionDelPlan(PLAN, at('2026-12-01T12:00:00.000Z'))!
    expect(s).toMatchObject({ motivo: 'mora', desde: VENCE, diaTerminacion: '2026-12-23' })
    expect(cumplioTreintaDias(s, at('2026-12-23T04:59:59.000Z'))).toBe(false)
    expect(cumplioTreintaDias(s, at('2026-12-23T05:00:00.000Z'))).toBe(true)
  })
})

describe('mora frente a reverso', () => {
  it('sin bolsa vencida ni corte, no hay suspensión', () => {
    expect(suspensionDelPlan(PLAN, at(VENCE) - 1)).toBeNull()
  })

  it('el reverso cuenta desde anulado_en; un corte pendiente (Valida no respondió) no suspende', () => {
    const corte = { estado: 'anulado' as const, monto: 150000, intentos: 1, anulado_en: '2026-11-10T20:00:00.000Z' }
    const conCorte: PlanAbierto = { ...PLAN, reversado: { at: '2026-11-10T19:00:00.000Z', referencia_pago: 'epayco-1', corte } }
    expect(suspensionDelPlan(conCorte, at('2026-11-15T12:00:00.000Z'))).toMatchObject({ motivo: 'reverso', diaTerminacion: '2026-12-11' })
    const pendiente: PlanAbierto = { ...conCorte, reversado: { ...conCorte.reversado!, corte: { ...corte, estado: 'pendiente' } } }
    expect(suspensionDelPlan(pendiente, at('2026-11-15T12:00:00.000Z'))).toBeNull()
  })

  it('con las dos, manda la que empezó primero', () => {
    const corte = { estado: 'anulado' as const, monto: 150000, intentos: 1, anulado_en: '2026-11-30T20:00:00.000Z' }
    const ambos: PlanAbierto = { ...PLAN, reversado: { at: corte.anulado_en, referencia_pago: 'epayco-1', corte } }
    expect(suspensionDelPlan(ambos, at('2026-12-05T12:00:00.000Z'))).toMatchObject({ motivo: 'mora', desde: VENCE })
  })
})

describe('el interruptor', () => {
  it('apagado en producción; un preview (y local) actúa', () => {
    expect(TERMINACION_30_DIAS_APROBADA).toBe(false)
    expect(terminacionHabilitada(PRODUCCION)).toBe(false)
    expect(terminacionHabilitada(PREVIEW)).toBe(true)
    expect(terminacionHabilitada({})).toBe(true)
  })
})

describe('la terminación (encendida, preview)', () => {
  it('el día 29 no hace nada; el 30 termina: sin cobros, tarjeta borrada, aviso interno y nada al cliente', async () => {
    const e = escenario(tablas(), PREVIEW)
    const r29 = await terminarSuspensionesVencidas(e.deps('2026-12-22T15:00:00.000Z'))
    expect(r29.revisados).toBe(0)
    expect(e.escrituras).toEqual([])

    const r = await terminarSuspensionesVencidas(e.deps('2026-12-23T12:00:00.000Z'))
    expect(r.terminados).toEqual(['ws-cli'])
    expect(r.errores).toEqual([])
    const t = e.tablas
    expect(t.servicios_contratados[0]).toMatchObject({ estado: 'terminado', vigente_hasta: '2026-12-23' })
    // El CDA no se toca.
    expect(t.servicios_contratados[1].estado).toBe('activo')
    expect(t.planes_cobro[0]).toMatchObject({ auto_renovar: false, activo: false })
    expect(t.suscripciones_producto[0]).toMatchObject({ estado: 'cancelada', metodo_pago_ref: null, metodo_pago_pasarela: null })
    expect(String(t.suscripciones_producto[0].cancelacion_motivo)).toContain('11.2')
    expect(t.valida_registros[0]).toMatchObject({ metodo_pago_estado: 'eliminado' })
    expect(e.pedidosBorrado).toEqual(['epayco:cus1:tok1'])
    expect(e.correos).toHaveLength(1)
    expect(e.correos[0].to).toBe('mauricio.moreno@metrik.com.co')
    expect(e.correos.some((c) => c.to === 'g@acme.co')).toBe(false)
    expect(e.correos[0].text).toContain('$300.000')
    expect(e.plan().terminacion).toMatchObject({
      estado: 'terminada',
      motivo: 'mora',
      dia_terminacion: '2026-12-23',
      cobros_cerrados: true,
      tarjeta: { estado: 'borrada' },
      aviso_interno: { estado: 'enviado' },
    })
    expect(t.suscripciones_producto_eventos.map((x) => x.tipo)).toEqual(['terminacion_11_2'])
  })

  it('idempotente: dos corridas (y la de mañana) no cierran, no borran ni avisan dos veces', async () => {
    const e = escenario(tablas(), PREVIEW)
    await terminarSuspensionesVencidas(e.deps('2026-12-23T12:00:00.000Z'))
    const r2 = await terminarSuspensionesVencidas(e.deps('2026-12-23T12:05:00.000Z'))
    await terminarSuspensionesVencidas(e.deps('2026-12-24T12:00:00.000Z'))
    expect(r2).toMatchObject({ revisados: 0, terminados: [] })
    expect(e.pedidosBorrado).toHaveLength(1)
    expect(e.correos).toHaveLength(1)
    expect(e.tablas.suscripciones_producto_eventos).toHaveLength(1)
  })

  it('el pago que llega el día 29 abre su ciclo: el día 30 no termina', async () => {
    // El webhook registró la cuota 2 y abrió su ciclo: el plan nuevo reemplaza al viejo.
    const nuevo: PlanAbierto = { ...PLAN, cobro_id: 'cobro-2', cuota_numero: 2, desde: '2026-11-13', hasta: '2026-12-12', vence_en: '2026-12-23T05:00:00.000Z' }
    const t = tablas(nuevo)
    t.cobros[1].fecha = '2026-12-22'
    const e = escenario(t, PREVIEW)
    const r = await terminarSuspensionesVencidas(e.deps('2026-12-23T12:00:00.000Z'))
    expect(r.terminados).toEqual([])
    expect(e.tablas.servicios_contratados[0].estado).toBe('activo')
    expect(e.pedidosBorrado).toEqual([])
    expect(e.correos).toEqual([])
  })

  it('el pago registrado cuyo ciclo no se abrió (Valida caída) tampoco es falta de pago', async () => {
    const t = tablas()
    t.cobros[1].fecha = '2026-12-22'
    const e = escenario(t, PREVIEW)
    const r = await terminarSuspensionesVencidas(e.deps('2026-12-23T12:00:00.000Z'))
    expect(r.sinDeuda).toEqual([{ workspaceId: 'ws-cli', detalle: 'la cuota 2 está pagada y su ciclo no se abrió' }])
    expect(r.terminados).toEqual([])
    expect(e.tablas.servicios_contratados[0].estado).toBe('activo')
  })

  it('un contrato ya retirado (terminado o cancelado) no se toca', async () => {
    const t = tablas()
    t.servicios_contratados[0].estado = 'cancelado'
    const e = escenario(t, PREVIEW)
    const r = await terminarSuspensionesVencidas(e.deps('2026-12-23T12:00:00.000Z'))
    expect(r.revisados).toBe(0)
    expect(e.escrituras).toEqual([])
  })

  it('por reverso: cuenta desde el corte y termina el 11-dic, no el 10', async () => {
    const corte = { estado: 'anulado' as const, monto: 150000, intentos: 1, anulado_en: '2026-11-10T20:00:00.000Z' }
    const plan: PlanAbierto = { ...PLAN, vence_en: '2026-11-23T05:00:00.000Z', reversado: { at: '2026-11-10T19:00:00.000Z', referencia_pago: 'epayco-1', corte } }
    const t = tablas(plan)
    Object.assign(t.cobros[0], { anulado_at: '2026-11-10T19:00:00.000Z', fecha: '2026-10-13' })
    const e = escenario(t, PREVIEW)
    expect((await terminarSuspensionesVencidas(e.deps('2026-12-10T15:00:00.000Z'))).terminados).toEqual([])
    const r = await terminarSuspensionesVencidas(e.deps('2026-12-11T12:00:00.000Z'))
    expect(r.terminados).toEqual(['ws-cli'])
    expect(e.plan().terminacion).toMatchObject({ motivo: 'reverso', dia_terminacion: '2026-12-11' })
  })

  it('el pago de reactivación registrado (ciclo sin abrir) levanta la suspensión por reverso', async () => {
    const corte = { estado: 'anulado' as const, monto: 150000, intentos: 1, anulado_en: '2026-11-10T20:00:00.000Z' }
    const plan: PlanAbierto = { ...PLAN, reversado: { at: '2026-11-10T19:00:00.000Z', referencia_pago: 'epayco-1', corte, recobro_cobro_id: 'recobro' } }
    const t = tablas(plan)
    Object.assign(t.cobros[0], { anulado_at: '2026-11-10T19:00:00.000Z' })
    t.cobros.push({ id: 'recobro', workspace_id: 'metrik', negocio_id: null, suscripcion_id: 'sus-1', plan_cobro_id: null, numero_cuota: null, fecha: '2026-12-09', anulado_at: null })
    const e = escenario(t, PREVIEW)
    const r = await terminarSuspensionesVencidas(e.deps('2026-12-11T12:00:00.000Z'))
    expect(r.sinDeuda[0]?.detalle).toContain('reactivación')
    expect(r.terminados).toEqual([])
  })

  it('si ePayco no borra, se reintenta al día siguiente sin volver a avisar ni a cerrar', async () => {
    let falla = true
    const e = escenario(tablas(), PREVIEW, async () => (falla ? { ok: false, error: 'ePayco 500' } : { ok: true, borradas: 1 }))
    const r1 = await terminarSuspensionesVencidas(e.deps('2026-12-23T12:00:00.000Z'))
    expect(r1.tarjetasPendientes).toEqual([{ workspaceId: 'ws-cli', detalle: 'ePayco 500' }])
    expect(e.plan().terminacion?.tarjeta).toMatchObject({ estado: 'pendiente', intentos: 1 })
    expect(e.tablas.valida_registros[0].metodo_pago_estado).toBe('registrado')
    falla = false
    await terminarSuspensionesVencidas(e.deps('2026-12-24T12:00:00.000Z'))
    expect(e.plan().terminacion?.tarjeta).toMatchObject({ estado: 'borrada', intentos: 2 })
    expect(e.tablas.valida_registros[0].metodo_pago_estado).toBe('eliminado')
    expect(e.pedidosBorrado).toHaveLength(2)
    expect(e.correos).toHaveLength(1)
    expect(e.tablas.suscripciones_producto_eventos).toHaveLength(1)
  })

  it('después de terminar, «Pagar el período» ya no da enlace', async () => {
    const corte = { estado: 'anulado' as const, monto: 150000, intentos: 1, anulado_en: '2026-11-10T20:00:00.000Z' }
    const plan: PlanAbierto = { ...PLAN, reversado: { at: '2026-11-10T19:00:00.000Z', referencia_pago: 'epayco-1', corte } }
    const t = tablas(plan)
    Object.assign(t.cobros[0], { anulado_at: '2026-11-10T19:00:00.000Z' })
    const e = escenario(t, PREVIEW)
    await terminarSuspensionesVencidas(e.deps('2026-12-11T12:00:00.000Z'))
    expect(await enlaceDeReactivacion('ws-cli', { db: e.db })).toEqual({ ok: false, error: PLAN_TERMINADO })
  })
})

describe('apagada en producción (ensayo)', () => {
  it('solo registra por_terminar y avisa a MéTRIK una vez; no cierra ni pide el borrado', async () => {
    const e = escenario(tablas(), PRODUCCION)
    const r = await terminarSuspensionesVencidas(e.deps('2026-12-23T12:00:00.000Z'))
    await terminarSuspensionesVencidas(e.deps('2026-12-24T12:00:00.000Z'))
    expect(r.porTerminar).toEqual(['ws-cli'])
    expect(r.terminados).toEqual([])
    expect(e.tablas.servicios_contratados[0].estado).toBe('activo')
    expect(e.tablas.planes_cobro[0]).toMatchObject({ auto_renovar: true, activo: true })
    expect(e.tablas.suscripciones_producto[0].estado).toBe('activa')
    expect(e.pedidosBorrado).toEqual([])
    expect(e.correos).toHaveLength(1)
    expect(e.correos[0].to).toBe('mauricio.moreno@metrik.com.co')
    expect(e.correos[0].subject).toContain('[Ensayo]')
    expect(e.plan().terminacion).toMatchObject({ estado: 'por_terminar', aviso_interno: { estado: 'enviado' } })
    expect(e.tablas.suscripciones_producto_eventos.map((x) => x.tipo)).toEqual(['terminacion_por_terminar'])
  })

  it('si el aviso de ensayo falla, se reintenta (sin repetir la bitácora)', async () => {
    const doble = crearDoble(tablas())
    let ok = false
    const enviados: unknown[] = []
    const deps = (ahora: string): DepsTerminacion => ({
      db: doble.db,
      ahoraMs: at(ahora),
      env: PRODUCCION,
      enviarCorreo: async (m) => (ok ? (enviados.push(m), { ok: true }) : { ok: false, error: 'resend 500' }),
      eliminarTarjeta: async () => ({ ok: true, borradas: 1 }),
    })
    await terminarSuspensionesVencidas(deps('2026-12-23T12:00:00.000Z'))
    ok = true
    await terminarSuspensionesVencidas(deps('2026-12-24T12:00:00.000Z'))
    await terminarSuspensionesVencidas(deps('2026-12-25T12:00:00.000Z'))
    expect(enviados).toHaveLength(1)
    expect(doble.tablas.suscripciones_producto_eventos).toHaveLength(1)
  })

  it('al encenderla (otro despliegue), el por_terminar se termina', async () => {
    const e = escenario(tablas(), PRODUCCION)
    await terminarSuspensionesVencidas(e.deps('2026-12-23T12:00:00.000Z'))
    const r = await terminarSuspensionesVencidas(e.deps('2026-12-24T12:00:00.000Z', PREVIEW))
    expect(r.terminados).toEqual(['ws-cli'])
    expect(e.tablas.servicios_contratados[0].estado).toBe('terminado')
    expect(e.correos).toHaveLength(2)
  })
})
