/**
 * El cierre del Radar de punta a punta: las lecturas reales de `acceso-servidor.ts` contra un doble
 * de tablas, y la PUERTA de las acciones, que es la que hace que el cierre sea un cierre y no una
 * pantalla. Un cliente con el trial vencido no puede guardar su perfil ni marcar procesos llamando
 * la acción a mano.
 *
 * El reparto de los pagos lo hace el mismo `cuotasConEstado` de `/suscripcion`: aquí se usa de
 * verdad, no simulado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearDoble, type Fila, type Tablas } from '../../../test/tablas-doble'

const WS_CLIENTE = 'ws-fabri'
const WS_COBRADOR = 'ws-metrik'
const NEGOCIO = 'n-fabri'
const PLAN = 'plan-1'
const HOY = '2026-10-04'

const escenario: { tablas: Tablas } = { tablas: {} }

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/dates/bogota', () => ({
  // Con una fecha, la de Bogotá (UTC-5) de ese instante; sin ella, «hoy» fijo.
  todayBogotaISO: (d?: Date) => (d ? new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 10) : HOY),
}))
vi.mock('./contexto', () => ({
  contextoRadar: async () => ({ tipo: 'ok', workspaceId: WS_CLIENTE, usuarioId: 'u-alex', role: 'owner' }),
}))
vi.mock('./entrada-servidor', () => ({
  entradaRadarAprobada: async () => true,
  entradaDelUsuarioRadar: async () => ({ tipo: 'ok' }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => crearDoble(escenario.tablas).db,
}))

const { accesoRadar, radarPermiteOperar } = await import('./acceso-servidor')
const { marcarProcesoRadar } = await import('./acciones')

function tablas(p: { cuotas?: Fila[]; cobros?: Fila[]; aceptaciones?: Fila[]; contrato?: Fila | null }): Tablas {
  const contrato =
    p.contrato === undefined
      ? {
          id: 'c-radar',
          workspace_id: WS_COBRADOR,
          negocio_id: NEGOCIO,
          estado: 'activo',
          servicio_slug: 'radar-secop-licencia',
          servicio_version: 1,
          parametros: { precio_mensual: 15_000, dias_trial: 5 },
          workspace_pagador_id: WS_CLIENTE,
        }
      : p.contrato
  return {
    catalogo_servicios: [{ slug: 'radar-secop-licencia', modulo: 'radar_secop' }],
    catalogo_servicios_versiones: [
      { slug: 'radar-secop-licencia', version: 1, definicion: { parametros: { dias_trial: { por_defecto: 5 } } } },
    ],
    servicio_contratado_beneficiarios: [],
    servicios_contratados: contrato ? [contrato] : [],
    aceptaciones_terminos: p.aceptaciones ?? [
      // 29-sep 14:30 UTC = 09:30 en Bogotá → el trial termina el 4-oct.
      { negocio_id: NEGOCIO, estado: 'aceptado', respondido_at: '2026-09-29T14:30:00Z' },
    ],
    planes_cobro: [{ id: PLAN, workspace_id: WS_COBRADOR, negocio_id: NEGOCIO }],
    plan_cobro_cuotas:
      p.cuotas ??
      [
        {
          id: 'q1',
          plan_cobro_id: PLAN,
          numero: 1,
          tipo: 'cuota',
          monto: 15_000,
          fecha_vencimiento: HOY,
          concepto_detalle: 'Suscripción Licencia Radar SECOP',
        },
      ],
    cobros: p.cobros ?? [
      {
        workspace_id: WS_COBRADOR,
        negocio_id: NEGOCIO,
        plan_cobro_id: PLAN,
        numero_cuota: 1,
        tipo_cobro: 'programado',
        monto: 15_000,
        fecha: null,
        anulado_at: null,
        enlace_pago_url: 'https://checkout.bold.co/abc',
        enlace_pago_expira: '2026-10-11T12:00:00Z',
      },
    ],
  }
}

beforeEach(() => {
  escenario.tablas = tablas({})
  // El reloj tiene que ser el MISMO que `hoy`: la vigencia de un enlace se compara contra el
  // instante real, y con el reloj de la máquina la prueba del enlace vencido midiría otra fecha.
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${HOY}T15:00:00Z`))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('el día 6, con la cuota sin pagar', () => {
  it('cierra el Radar y entrega el enlace de pago de esa cuota', async () => {
    const { acceso, pago } = await accesoRadar()
    expect(acceso).toMatchObject({ estado: 'cerrado', motivo: 'trial_vencido', desde: HOY })
    expect(pago).toEqual({ saldo: 15_000, vence: HOY, enlace: 'https://checkout.bold.co/abc' })
  })

  it('la acción de marcar un proceso se NIEGA por POST, no solo en pantalla', async () => {
    const r = await marcarProcesoRadar('CO1.NTC.123', 'sigue')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('Tu prueba del Radar terminó el 4-oct')
    // Y nada se escribió: el doble no tiene ni una fila de seguimiento.
    expect(escenario.tablas.radar_seguimiento ?? []).toEqual([])
  })

  it('un enlace ya vencido no se ofrece: se pide uno nuevo, no se pinta uno muerto', async () => {
    escenario.tablas = tablas({
      cobros: [
        {
          workspace_id: WS_COBRADOR,
          negocio_id: NEGOCIO,
          plan_cobro_id: PLAN,
          numero_cuota: 1,
          tipo_cobro: 'programado',
          monto: 15_000,
          fecha: null,
          anulado_at: null,
          enlace_pago_url: 'https://checkout.bold.co/abc',
          enlace_pago_expira: '2026-09-30T12:00:00Z',
        },
      ],
    })
    const { pago } = await accesoRadar()
    expect(pago?.enlace).toBeNull()
  })
})

describe('el día 5 y con el pago hecho', () => {
  it('en trial: abierto, y las acciones pasan', async () => {
    // El trial termina el 4-oct; el 3-oct todavía está dentro. Se mueve la aceptación un día para
    // no tocar el `hoy` del módulo.
    escenario.tablas = tablas({
      aceptaciones: [{ negocio_id: NEGOCIO, estado: 'aceptado', respondido_at: '2026-09-30T14:30:00Z' }],
      cuotas: [
        { id: 'q1', plan_cobro_id: PLAN, numero: 1, tipo: 'cuota', monto: 15_000, fecha_vencimiento: '2026-10-05' },
      ],
    })
    const { acceso, pago } = await accesoRadar()
    expect(acceso).toMatchObject({ estado: 'en_trial', finTrial: '2026-10-05', diasRestantes: 1 })
    expect(await radarPermiteOperar()).toEqual({ ok: true })
    // El banner necesita el enlace y el precio DEL CLIENTE ($15.000, no los $20.000 de lista): sale
    // de la cuota, que es lo mismo que cobra el enlace.
    expect(pago).toEqual({ saldo: 15_000, vence: '2026-10-05', enlace: 'https://checkout.bold.co/abc' })
  })

  it('con la cuota pagada queda al día y dice hasta cuándo está cubierto', async () => {
    escenario.tablas = tablas({
      cuotas: [
        { id: 'q1', plan_cobro_id: PLAN, numero: 1, tipo: 'cuota', monto: 15_000, fecha_vencimiento: HOY },
        { id: 'q2', plan_cobro_id: PLAN, numero: 2, tipo: 'cuota', monto: 15_000, fecha_vencimiento: '2026-11-04' },
      ],
      cobros: [
        {
          workspace_id: WS_COBRADOR,
          negocio_id: NEGOCIO,
          plan_cobro_id: PLAN,
          numero_cuota: 1,
          tipo_cobro: 'programado',
          monto: 15_000,
          fecha: '2026-10-03',
          anulado_at: null,
        },
      ],
    })
    const { acceso, pago } = await accesoRadar()
    expect(acceso).toEqual({ estado: 'al_dia', cubiertoHasta: '2026-11-04' })
    expect(pago).toBeNull()
    expect(await radarPermiteOperar()).toEqual({ ok: true })
  })

  it('un cobro ANULADO no cuenta como pago: sigue cerrado', async () => {
    escenario.tablas = tablas({
      cobros: [
        {
          workspace_id: WS_COBRADOR,
          negocio_id: NEGOCIO,
          plan_cobro_id: PLAN,
          numero_cuota: 1,
          tipo_cobro: 'programado',
          monto: 15_000,
          fecha: '2026-10-03',
          anulado_at: '2026-10-03T20:00:00Z',
        },
      ],
    })
    const { acceso } = await accesoRadar()
    expect(acceso).toMatchObject({ estado: 'cerrado' })
  })
})

describe('el ancla sale de la aceptación más vieja', () => {
  it('una aceptación posterior (versión nueva de los términos) no corre el trial', async () => {
    escenario.tablas = tablas({
      aceptaciones: [
        { negocio_id: NEGOCIO, estado: 'aceptado', respondido_at: '2026-10-03T14:30:00Z' },
        { negocio_id: NEGOCIO, estado: 'aceptado', respondido_at: '2026-09-29T14:30:00Z' },
      ],
    })
    const { acceso } = await accesoRadar()
    // Con la aceptación nueva como ancla, el trial terminaría el 8-oct y el módulo seguiría abierto.
    expect(acceso).toMatchObject({ estado: 'cerrado', desde: HOY })
  })

  it('la aceptación se cuenta en el día de BOGOTÁ: 02:00 UTC es del día anterior', async () => {
    escenario.tablas = tablas({
      // 03:00Z del 30-sep = 22:00 del 29-sep en Bogotá → trial hasta el 4-oct → hoy cierra.
      aceptaciones: [{ negocio_id: NEGOCIO, estado: 'aceptado', respondido_at: '2026-09-30T03:00:00Z' }],
    })
    const { acceso } = await accesoRadar()
    expect(acceso).toMatchObject({ estado: 'cerrado', desde: HOY })
  })
})

describe('cuando esto no decide nada', () => {
  it('sin contrato de Radar el módulo queda abierto', async () => {
    escenario.tablas = tablas({ contrato: null })
    const { acceso } = await accesoRadar()
    expect(acceso).toEqual({ estado: 'sin_contrato' })
    expect(await radarPermiteOperar()).toEqual({ ok: true })
  })

  it('un contrato de otro espacio no cierra este módulo', async () => {
    escenario.tablas = tablas({
      contrato: {
        id: 'c-otro',
        workspace_id: WS_COBRADOR,
        negocio_id: NEGOCIO,
        estado: 'activo',
        servicio_slug: 'radar-secop-licencia',
        servicio_version: 1,
        parametros: { dias_trial: 5 },
        workspace_pagador_id: 'ws-de-otro',
      },
    })
    const { acceso } = await accesoRadar()
    expect(acceso).toEqual({ estado: 'sin_contrato' })
  })

  it('sin ficha del módulo en el catálogo no hay nada que cobrar', async () => {
    escenario.tablas = { ...tablas({}), catalogo_servicios: [] }
    const { acceso } = await accesoRadar()
    expect(acceso).toEqual({ estado: 'sin_contrato' })
  })
})
