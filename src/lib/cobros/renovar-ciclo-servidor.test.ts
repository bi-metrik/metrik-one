/**
 * El paso 6b del cron contra un doble que LEE y ESCRIBE. La aritmética la fija `renovar-ciclo.test.ts`;
 * aquí, de dónde salen los datos: qué contrato manda en el negocio, qué cuota cuenta como pagada, y
 * que dos corridas el mismo día dejan UNA cuota nueva.
 */
import { describe, expect, it } from 'vitest'
import { crearDoble, type Tablas } from '../../../test/tablas-doble'
import { renovarPlanesPorCiclo } from './renovar-ciclo-servidor'

const WS = 'ws-metrik'
const CONCEPTO = 'Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS)'

function cuotas(plan: string, n: number) {
  const periodos = ['23-sep al 22-oct', '23-oct al 22-nov', '23-nov al 22-dic', '23-dic al 22-ene']
  const vence = ['2026-09-30', '2026-10-27', '2026-11-27', '2026-12-27']
  return Array.from({ length: n }, (_, i) => ({
    id: `${plan}-q${i + 1}`,
    workspace_id: WS,
    plan_cobro_id: plan,
    numero: i + 1,
    tipo: 'cuota',
    monto: 150_000,
    fecha_vencimiento: vence[i],
    concepto_detalle: `${CONCEPTO} · periodo del ${periodos[i]}`,
  }))
}

const pagado = (plan: string, numero: number) => ({
  id: `cobro-${plan}-${numero}`,
  plan_cobro_id: plan,
  numero_cuota: numero,
  fecha: '2026-10-02',
  anulado_at: null,
})

function plan(id: string, negocio: string, total: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    workspace_id: WS,
    negocio_id: negocio,
    frecuencia: 'mensual',
    fecha_inicio: '2026-09-23',
    fecha_fin: total === 4 ? '2027-01-22' : '2026-12-22',
    total_cuotas: total,
    auto_renovar: true,
    activo: false,
    concepto_detalle_template: CONCEPTO,
    ...extra,
  }
}

function contrato(id: string, negocio: string, estado: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    workspace_id: WS,
    negocio_id: negocio,
    estado,
    servicio_slug: 'valida-cda-licencia',
    parametros: { licencias: 2, precio_mensual: 150_000 },
    vigente_desde: '2026-09-23',
    vigente_hasta: null,
    ...extra,
  }
}

function base(extra: Partial<Tablas> = {}): Tablas {
  return {
    catalogo_servicios: [
      { slug: 'valida-cda-licencia', modulo: 'valida_consulta', disparador_cobro: 'ciclo' },
      { slug: 'licencia-clarity', modulo: 'business', disparador_cobro: 'ciclo' },
    ],
    servicios_contratados: [
      // C1 26 1: un contrato cancelado al lado del activo, como en producción.
      contrato('c1-viejo', 'n-c1', 'cancelado'),
      contrato('c1', 'n-c1', 'activo'),
    ],
    planes_cobro: [plan('p-c1', 'n-c1', 4)],
    plan_cobro_cuotas: cuotas('p-c1', 4),
    cobros: [pagado('p-c1', 1), pagado('p-c1', 2), pagado('p-c1', 3)],
    planes_anuales_cda: [],
    ...extra,
  }
}

describe('el paso 6b renueva el plan de un CDA', () => {
  it('el 28-nov agrega la cuota 5 (27-ene) y ajusta el plan, sin tocar activo', async () => {
    const { db, tablas } = crearDoble(base())
    const r = await renovarPlanesPorCiclo({ db, hoy: '2026-11-28' })

    expect(r.errores).toEqual([])
    expect(r.renovados).toEqual([{ planCobroId: 'p-c1', numero: 5, fechaVencimiento: '2027-01-27', monto: 150_000 }])
    expect(tablas.plan_cobro_cuotas).toHaveLength(5)
    expect(tablas.plan_cobro_cuotas?.[4]).toMatchObject({
      workspace_id: WS,
      plan_cobro_id: 'p-c1',
      numero: 5,
      tipo: 'cuota',
      fecha_vencimiento: '2027-01-27',
      concepto_detalle: `${CONCEPTO} · periodo del 23-ene al 22-feb`,
    })
    expect(tablas.planes_cobro?.[0]).toMatchObject({ total_cuotas: 5, fecha_fin: '2027-02-22', activo: false })
    // No crea cobros: el cobro y su enlace los hace el paso 6, siete días antes del vencimiento.
    expect(tablas.cobros).toHaveLength(3)
  })

  it('dos corridas el mismo día dejan UNA cuota nueva', async () => {
    const { db, tablas } = crearDoble(base())
    await renovarPlanesPorCiclo({ db, hoy: '2026-11-28' })
    const segunda = await renovarPlanesPorCiclo({ db, hoy: '2026-11-28' })
    expect(segunda.renovados).toEqual([])
    expect(segunda.descartes).toEqual({ horizonte_cubierto: 1 })
    expect(tablas.plan_cobro_cuotas).toHaveLength(5)
  })

  it('una cuota repetida por otra corrida (llave única) se cuenta, no se reporta como error', async () => {
    const { db: doble, tablas } = crearDoble(base())
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { from: (t: string) => (t === 'plan_cobro_cuotas' ? { ...(doble as any).from(t), insert: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) } : (doble as any).from(t)) } as any
    const r = await renovarPlanesPorCiclo({ db, hoy: '2026-11-28' })
    expect(r.yaEstaban).toBe(1)
    expect(r.errores).toEqual([])
    // Y el plan no se ajusta sobre una cuota que no escribió esta corrida.
    expect(tablas.planes_cobro?.[0].total_cuotas).toBe(4)
  })
})

describe('lo que no renueva', () => {
  it('El Carmen, que debe la cuota 1, no recibe cuotas nuevas', async () => {
    const { db, tablas } = crearDoble(base({ cobros: [] }))
    const r = await renovarPlanesPorCiclo({ db, hoy: '2026-11-28' })
    expect(r.descartes).toEqual({ en_mora: 1 })
    expect(tablas.plan_cobro_cuotas).toHaveLength(4)
  })

  it('un cobro anulado no cuenta como pagado', async () => {
    const { db } = crearDoble(base({ cobros: [{ ...pagado('p-c1', 1), anulado_at: '2026-10-03T00:00:00Z' }, pagado('p-c1', 2), pagado('p-c1', 3)] }))
    const r = await renovarPlanesPorCiclo({ db, hoy: '2026-11-28' })
    expect(r.descartes).toEqual({ en_mora: 1 })
  })

  it('un plan sin auto_renovar (los 4 CDA antes del script, o uno dado de baja) ni se lee', async () => {
    const { db, tablas } = crearDoble(base({ planes_cobro: [plan('p-c1', 'n-c1', 4, { auto_renovar: false })] }))
    const r = await renovarPlanesPorCiclo({ db, hoy: '2026-11-28' })
    expect(r.planes).toBe(0)
    expect(tablas.plan_cobro_cuotas).toHaveLength(4)
  })

  it('un contrato dado de baja (terminado) no renueva aunque el plan siga con auto_renovar', async () => {
    const { db } = crearDoble(base({ servicios_contratados: [contrato('c1', 'n-c1', 'terminado')] }))
    const r = await renovarPlanesPorCiclo({ db, hoy: '2026-11-28' })
    expect(r.descartes).toEqual({ estado: 1 })
  })

  it('el plan anual activo frena hasta su periodo_hasta; vencido, deja de frenar', async () => {
    const anual = { plan_cobro_id: 'p-c1', estado: 'activo', periodo_hasta: '2027-09-22' }
    const conAnual = crearDoble(base({ planes_anuales_cda: [anual] }))
    expect((await renovarPlanesPorCiclo({ db: conAnual.db, hoy: '2026-11-28' })).descartes).toEqual({ plan_anual: 1 })

    const vencido = crearDoble(base({ planes_anuales_cda: [{ ...anual, periodo_hasta: '2026-11-01' }] }))
    expect((await renovarPlanesPorCiclo({ db: vencido.db, hoy: '2026-11-28' })).renovados).toHaveLength(1)
  })

  it('un plan de otro módulo con auto_renovar no se toca', async () => {
    const { db, tablas } = crearDoble(
      base({
        servicios_contratados: [{ ...contrato('cl', 'n-cl', 'activo'), servicio_slug: 'licencia-clarity' }],
        planes_cobro: [plan('p-cl', 'n-cl', 4)],
        plan_cobro_cuotas: cuotas('p-cl', 4),
        cobros: [pagado('p-cl', 1), pagado('p-cl', 2), pagado('p-cl', 3)],
      }),
    )
    const r = await renovarPlanesPorCiclo({ db, hoy: '2026-11-28' })
    expect(r.renovados).toEqual([])
    expect(tablas.plan_cobro_cuotas).toHaveLength(4)
  })
})
