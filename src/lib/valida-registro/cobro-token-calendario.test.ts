/**
 * El calendario de mora de las cuotas mensuales cobradas con la tarjeta (decisión de Mauricio del
 * 2026-10-14, Carmen §2.3): día 0 cobro, reintentos los días 3 y 7, suspensión el día 10.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import type { PasarelaAdapter, ResultadoCargo, SolicitudCargo } from '@/lib/suscripciones/pasarela/adapter'

vi.mock('@/lib/cobros/pago-en-linea', () => ({
  procesarEventoPasarela: async () => ({ resultado: 'registrado', detalle: 'Pago registrado.', cobroId: 'x' }),
}))
vi.mock('@/lib/cobros/pago-en-linea-servidor', () => ({ repoPagoEnLinea: () => ({}) }))
const actividad: string[] = []
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_db: unknown, fila: { contenido: string }) => {
    actividad.push(fila.contenido)
  },
}))

const { cobrarCuotasConTarjeta, cuotasConTarjetaRechazada } = await import('./cobro-token-servidor')

const METRIK = 'ws-metrik'
const PAGADOR = 'ws-cli'
const REF = 'epayco:DiYPdhgncppes9KAb:XCX92PZqBKfmcWFbA'

function base(): Tablas {
  return {
    servicios_contratados: [{ id: 'sc', workspace_id: METRIK, negocio_id: 'n1', estado: 'activo', workspace_pagador_id: PAGADOR }],
    workspaces: [{ id: PAGADOR, config_extra: { origen_registro: 'valida_autogestion', valida_pagador: { celular: '3001234567' } } }],
    valida_registros: [
      { workspace_id: PAGADOR, estado: 'creado', metodo_pago_estado: 'registrado', metodo_pago_ref: REF, correo: 'g@acme.co', identificacion: '900123456', razon_social: 'ACME S.A.S.' },
    ],
    planes_cobro: [{ id: 'p1', workspace_id: METRIK, negocio_id: 'n1', pasarela: 'epayco', total_cuotas: 2 }],
    plan_cobro_cuotas: [
      { id: 'q1', workspace_id: METRIK, plan_cobro_id: 'p1', numero: 1, monto: 150000, fecha_vencimiento: '2026-10-21', concepto_detalle: 'Valida · periodo 1' },
      { id: 'q2', workspace_id: METRIK, plan_cobro_id: 'p1', numero: 2, monto: 150000, fecha_vencimiento: '2026-11-21', concepto_detalle: 'Valida · periodo 2' },
    ],
    // La cuota 1 ya se pagó al cumplirse los 7 días de la prueba.
    cobros: [{ id: 'c1', workspace_id: METRIK, plan_cobro_id: 'p1', numero_cuota: 1, tipo_cobro: 'programado', fecha: '2026-10-21', anulado_at: null, external_ref: 'epayco-1' }],
    cobro_intentos_tarjeta: [],
  }
}

/** La llave única (plan, cuota, intento) de la base, que el doble no tiene. */
function conLlaveUnica(db: ReturnType<typeof crearDoble>['db'], tablas: Tablas) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const real = db as any
  return {
    from(t: string) {
      const q = real.from(t)
      if (t !== 'cobro_intentos_tarjeta') return q
      const insertar = q.insert
      q.insert = (fila: Record<string, unknown>) => {
        const choca = (tablas.cobro_intentos_tarjeta ?? []).some((f) => f.plan_cobro_id === fila.plan_cobro_id && f.numero_cuota === fila.numero_cuota && f.intento === fila.intento)
        if (choca) {
          const err = { data: null, error: { code: '23505', message: 'duplicate key cobro_intentos_tarjeta_uno_por_dia' } }
          const r = { select: () => r, single: async () => err, then: (ok: (x: unknown) => unknown) => Promise.resolve(err).then(ok) }
          return r
        }
        return insertar(fila)
      }
      return q
    },
  } as unknown as ReturnType<typeof crearDoble>['db']
}

function epayco(secuencia: ResultadoCargo[]) {
  const cargos: SolicitudCargo[] = []
  const adapter = {
    nombre: 'epayco',
    capacidades: { cobroSinClic: true, tokenizacion: true, linkDePago: false, webhook: true },
    cobrar: async (s: SolicitudCargo) => {
      // Cede el turno como una llamada real: dos corridas a la vez se intercalan.
      await new Promise((r) => setTimeout(r, 0))
      cargos.push(s)
      return secuencia[Math.min(cargos.length - 1, secuencia.length - 1)]
    },
    consultar: async () => secuencia[0],
  } as unknown as PasarelaAdapter
  return { adapterPara: (p: string) => (p === 'epayco' ? adapter : null), cargos }
}

const RECHAZO: ResultadoCargo = { estado: 'rechazado', externalRef: 'epayco-9', codigo: '2', mensaje: 'Fondos insuficientes', reintentable: false }
const APROBADO: ResultadoCargo = { estado: 'aprobado', externalRef: 'epayco-10', fecha: '2026-11-28', monto: 150000 }

beforeEach(() => {
  actividad.length = 0
})

describe('una cuota mensual rechazada sigue el calendario: días 0, 3 y 7; suspensión el 10', () => {
  it('rechazada todos los días: tres intentos exactos, el plan SIGUE en la tarjeta, nada desde el día 10', async () => {
    const d = crearDoble(base())
    const db = conLlaveUnica(d.db, d.tablas)
    const e = epayco([RECHAZO])
    const correr = (hoy: string) => cobrarCuotasConTarjeta({ db, adapterPara: e.adapterPara, hoy, ahoraMs: Date.parse(`${hoy}T12:00:00Z`) })

    for (const dia of ['21', '22', '23']) await correr(`2026-11-${dia}`) // días 0, 1 y 2
    expect(e.cargos).toHaveLength(1)
    expect(d.tablas.planes_cobro[0].pasarela).toBe('epayco')
    expect(actividad[0]).toMatch(/se reintenta con la tarjeta el día 3/)

    for (const dia of ['24', '25', '27']) await correr(`2026-11-${dia}`) // días 3, 4 y 6
    expect(e.cargos).toHaveLength(2)
    for (const dia of ['28', '30']) await correr(`2026-11-${dia}`) // días 7 y 9
    expect(e.cargos).toHaveLength(3)
    expect(actividad[2]).toMatch(/Último intento/)

    const r = await correr('2026-12-01') // día 10
    expect(e.cargos).toHaveLength(3)
    expect(r.suspendidos).toBe(1)
    expect(d.tablas.cobro_intentos_tarjeta.map((f) => [f.intento, f.resultado])).toEqual([
      [0, 'rechazado'],
      [1, 'rechazado'],
      [2, 'rechazado'],
    ])
  })

  it('el reintento del día 3 aprobado cierra la cuota: no hay intento del día 7', async () => {
    const d = crearDoble(base())
    const db = conLlaveUnica(d.db, d.tablas)
    const e = epayco([RECHAZO, APROBADO])
    await cobrarCuotasConTarjeta({ db, adapterPara: e.adapterPara, hoy: '2026-11-21' })
    const r = await cobrarCuotasConTarjeta({ db, adapterPara: e.adapterPara, hoy: '2026-11-24' })
    expect(r.aprobadas).toBe(1)
    expect(d.tablas.cobro_intentos_tarjeta.map((f) => f.resultado)).toEqual(['rechazado', 'aprobado'])
  })

  it('dos corridas A LA VEZ el mismo día cobran una sola vez (llave única por intento)', async () => {
    const d = crearDoble(base())
    const db = conLlaveUnica(d.db, d.tablas)
    const e = epayco([RECHAZO])
    const [a, b] = await Promise.all([
      cobrarCuotasConTarjeta({ db, adapterPara: e.adapterPara, hoy: '2026-11-21' }),
      cobrarCuotasConTarjeta({ db, adapterPara: e.adapterPara, hoy: '2026-11-21' }),
    ])
    expect(e.cargos).toHaveLength(1)
    expect(a.yaIntentadas + b.yaIntentadas).toBe(1)
  })

  it('sin la tabla de intentos (migración sin aplicar) no cobra', async () => {
    const d = crearDoble(base())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const real = d.db as any
    const db = {
      from: (t: string) => {
        if (t !== 'cobro_intentos_tarjeta') return real.from(t)
        const err = { data: null, error: { code: '42P01', message: 'relation does not exist' } }
        const q: Record<string, unknown> = {}
        for (const k of ['select', 'eq', 'insert', 'in']) q[k] = () => q
        q.maybeSingle = async () => err
        q.single = async () => err
        return q
      },
    } as unknown as typeof d.db
    const e = epayco([APROBADO])
    const r = await cobrarCuotasConTarjeta({ db, adapterPara: e.adapterPara, hoy: '2026-11-21' })
    expect(e.cargos).toHaveLength(0)
    expect(r.errores).toHaveLength(1)
  })

  it('una cuota suspendida frena el plan: la del mes siguiente no se cobra', async () => {
    const t = base()
    t.plan_cobro_cuotas.push({ id: 'q3', workspace_id: METRIK, plan_cobro_id: 'p1', numero: 3, monto: 150000, fecha_vencimiento: '2026-12-21', concepto_detalle: 'Valida · periodo 3' })
    const d = crearDoble(t)
    const e = epayco([APROBADO])
    const r = await cobrarCuotasConTarjeta({ db: conLlaveUnica(d.db, d.tablas), adapterPara: e.adapterPara, hoy: '2026-12-21' })
    expect(e.cargos).toHaveLength(0)
    expect(r.suspendidos).toBe(1)
  })
})

describe('qué cuotas de un plan con tarjeta reciben enlace', () => {
  it('solo las que tienen un cobro con tarjeta rechazado', async () => {
    const d = crearDoble({
      cobro_intentos_tarjeta: [
        { plan_cobro_id: 'p1', numero_cuota: 2, intento: 0, resultado: 'rechazado' },
        { plan_cobro_id: 'p1', numero_cuota: 3, intento: 0, resultado: 'aprobado' },
        { plan_cobro_id: 'p9', numero_cuota: 1, intento: 0, resultado: 'rechazado' },
      ],
    })
    expect([...(await cuotasConTarjetaRechazada(d.db, ['p1']))]).toEqual(['p1|2'])
  })
})

describe('con el plan cortado por el reverso de un pago, la tarjeta no se toca (Mik, 2026-10-27)', () => {
  const PLAN_CORTADO = {
    cliente_id: 'cli-1',
    limite_mes: 3000,
    cobro_id: 'c1',
    cuota_numero: 1,
    desde: '2026-10-21',
    hasta: '2026-11-20',
    vence_en: '2026-12-01T05:00:00.000Z',
    abierto_at: '2026-10-21T12:00:00Z',
  }
  function cortado(estado: 'pendiente' | 'anulado' | 'no_aplica' | 'final') {
    const t = base()
    // La cuota 1 se reversó: el cobro queda anulado y conserva su fecha.
    Object.assign(t.cobros[0], { anulado_at: '2026-10-27T15:00:00Z', monto: 0, monto_anulado: 150000 })
    Object.assign(t.workspaces[0].config_extra as Record<string, unknown>, {
      valida_plan: { ...PLAN_CORTADO, reversado: { at: '2026-10-27T15:00:00Z', referencia_pago: 'epayco-1', corte: { estado, monto: 150000, intentos: 1 } } },
    })
    return t
  }
  const correr = (d: ReturnType<typeof crearDoble>, e: ReturnType<typeof epayco>) =>
    cobrarCuotasConTarjeta({ db: conLlaveUnica(d.db, d.tablas), adapterPara: e.adapterPara, hoy: '2026-11-21', ahoraMs: Date.parse('2026-11-21T12:00:00Z') })

  it.each(['anulado', 'pendiente'] as const)('corte %s: ni la cuota siguiente ni la reversada se cargan', async (estado) => {
    const d = crearDoble(cortado(estado))
    const e = epayco([APROBADO])
    const r = await correr(d, e)
    expect(e.cargos).toHaveLength(0)
    expect(r.cortadosPorReverso).toBe(1)
    expect(r.revisadas).toBe(0)
    expect(d.tablas.cobro_intentos_tarjeta).toHaveLength(0)
  })

  it('sin corte (otro pago válido cubrió la cuota: no_aplica) la cuota siguiente se carga como siempre', async () => {
    const d = crearDoble(cortado('no_aplica'))
    const e = epayco([APROBADO])
    const r = await correr(d, e)
    expect(r.cortadosPorReverso).toBe(0)
    expect(e.cargos).toHaveLength(1)
  })

  it('pagada la reactivación (ciclo nuevo, sin marca), la cuota siguiente vuelve a cargarse', async () => {
    const t = cortado('anulado')
    ;(t.workspaces[0].config_extra as Record<string, unknown>).valida_plan = { ...PLAN_CORTADO, cobro_id: 'recobro-1' }
    const d = crearDoble(t)
    const e = epayco([APROBADO])
    await correr(d, e)
    expect(e.cargos).toHaveLength(1)
  })
})
