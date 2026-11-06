import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * La pestaña Pagos de `/suscripcion` (`leerPagosCda`) con la cartera de la 11.7 (revisión de Vera del 5-nov):
 * el CDA que aceptó la v1.5 tarde y vuelve a empezar (16.4) ve lo de antes del 1-dic sin pagar como saldo
 * pendiente, igual que con la Cancelada. Lecturas reales (`leerPestanaPagosCda`) sobre RPC dobles.
 */

const SC = '11111111-1111-4111-8111-111111111111'
const CONCEPTO = 'Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS) · periodo del'
const escenario: { cuotas: unknown[]; cobros: unknown[]; hoy: string } = { cuotas: [], cobros: [], hoy: '2026-12-26' }

vi.mock('@/lib/dates/bogota', () => ({ todayBogotaISO: () => escenario.hoy }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: {
      rpc: async (nombre: string) => ({ data: nombre === 'mis_cuotas_de_servicio' ? escenario.cuotas : escenario.cobros, error: null }),
    },
  }),
}))
vi.mock('@/lib/valida-api/terminos-servidor', () => ({
  documentosDelCliente: async () => ({ ok: true, documentos: [] }),
}))
vi.mock('./puerta', () => ({ puedeVerPagosCda: async () => true }))
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), cache: <T,>(f: T) => f }))

import { leerPagosCda } from './pestanas-servidor'
import type { EntradaValidaCda } from './puerta'

const cuota = (numero: number, vence: string, periodo: string) => ({
  cuota_id: `q${numero}`,
  numero,
  tipo: 'cuota',
  monto: '150000',
  fecha_vencimiento: vence,
  concepto: `${CONCEPTO} ${periodo}`,
  enlace_pago_url: null,
  enlace_pago_expira: null,
  factura_numero: null,
  factura_pdf_path: null,
  factura_xml_path: null,
})

function entrada(cancelada: string | null): EntradaValidaCda {
  return {
    tipo: 'ok',
    workspaceId: 'ws',
    usuarioId: 'u',
    usuarioEfectivoId: 'u',
    impersonando: false,
    role: 'owner',
    estado: { estado: 'aprobada' } as never,
    hoy: escenario.hoy,
    servicioContratadoId: SC,
    plazoTerminos: null,
    enPlazo: false,
    modificaciones: [],
    modificacion: null,
    restriccionDesde: '2026-11-06',
    transicionDesde: '2026-12-01',
    autoservicio: false,
    usuarioDelCliente: true,
    canceladaDesde: cancelada,
  }
}

const numeros = (xs: { numero: number }[] | undefined) => (xs ?? []).map((c) => c.numero)

describe('leerPagosCda: la cartera de la 11.7 al volver a empezar (16.4)', () => {
  beforeEach(() => {
    escenario.hoy = '2026-12-26'
    escenario.cuotas = [cuota(1, '2026-09-30', '23-sep al 22-oct'), cuota(2, '2026-10-27', '23-oct al 22-nov'), cuota(3, '2026-11-27', '23-nov al 22-dic')]
    escenario.cobros = [{ cobro_id: 'c', fecha: '2026-11-04', monto: '300000', fuente: 'bold', estado: 'pagado', recibo_numero: null, recibo_path: null }]
  })

  it('Maxitec acepta tarde (26-dic) con la cuota 3 sin pagar: va a la cartera, no a las cuotas', async () => {
    const r = await leerPagosCda(entrada(null), { carteraDeTransicion: true })
    expect(r.estado).toBe('ok')
    if (r.estado !== 'ok') return
    expect(numeros(r.cartera)).toEqual([3])
    expect(numeros(r.cuotas)).toEqual([1, 2])
  })

  it('sin la opción (al día o aceptada a tiempo: la página no la pasa), como siempre', async () => {
    const r = await leerPagosCda(entrada(null))
    if (r.estado !== 'ok') throw new Error(r.estado)
    expect(numeros(r.cartera)).toEqual([])
    expect(numeros(r.cuotas)).toEqual([1, 2, 3])
    // Al día: con la opción tampoco aparece saldo (no hay qué mover).
    escenario.cobros = [{ cobro_id: 'c', fecha: '2026-11-25', monto: '450000', fuente: 'bold', estado: 'pagado', recibo_numero: null, recibo_path: null }]
    const alDia = await leerPagosCda(entrada(null), { carteraDeTransicion: true })
    if (alDia.estado !== 'ok') throw new Error(alDia.estado)
    expect(numeros(alDia.cartera)).toEqual([])
  })

  it('Cancelada: igual con o sin la opción', async () => {
    const a = await leerPagosCda(entrada('2026-12-31'))
    const b = await leerPagosCda(entrada('2026-12-31'), { carteraDeTransicion: true })
    if (a.estado !== 'ok' || b.estado !== 'ok') throw new Error('no ok')
    expect(numeros(a.cartera)).toEqual([3])
    expect(numeros(b.cartera)).toEqual([3])
  })
})
