import { describe, expect, it } from 'vitest'
import { planearRenovacion } from '@/lib/cobros/renovar-ciclo'
import {
  asuntoCorreoCancelada,
  asuntoCorreoTarjetaCancelada,
  carteraDe,
  htmlCorreoCancelada,
  htmlCorreoTarjetaCancelada,
  cuotasParaAnular,
  planDeReactivacion,
  separarPorEpoca,
  textoCorreoCancelada,
  textoCorreoTarjetaCancelada,
  textosPantallaCancelada,
  valorDeUnPeriodo,
} from './cancelada'
import { cuotasConEstado, proximoPago, type CobroRecibido, type CuotaDeServicio } from './pago-pendiente'
import { estadoMora, REGLA_MORA_CDA } from './plazos'

/**
 * La Cancelada guardada y la reactivación (Términos v1.5, 2.5, 11.3, 11.4 y 11.7; PR B del 4-nov), lo puro:
 * las fechas, qué se anula, qué es cartera, el plan nuevo y los textos.
 */

const V15 = '2026-12-01'
const V14 = '2026-11-06'
const BASE = 'Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS)'

function cuota(numero: number, desde: string, hasta: string, vence: string, extra: Partial<CuotaDeServicio> = {}): CuotaDeServicio & { planFechaInicio?: string | null; anulada?: boolean } {
  return {
    cuotaId: `q${numero}`,
    numero,
    tipo: 'cuota',
    monto: 150000,
    fechaVencimiento: vence,
    concepto: `${BASE} · periodo del ${desde} al ${hasta}`,
    enlacePagoUrl: null,
    enlacePagoExpira: null,
    planFechaInicio: '2026-09-23',
    ...extra,
  }
}

/** El plan de Caquetá: 4 cuotas, la 1 pagada. */
const CAQUETA = [
  cuota(1, '23-sep', '22-oct', '2026-09-30'),
  cuota(2, '23-oct', '22-nov', '2026-10-27'),
  cuota(3, '23-nov', '22-dic', '2026-11-27'),
  cuota(4, '23-dic', '22-ene', '2026-12-27'),
]
const PAGO = (monto = 150000, extra: object = {}): CobroRecibido & { planFechaInicio?: string | null; esReactivacion?: boolean } => ({
  monto,
  estado: 'pagado',
  planFechaInicio: '2026-09-23',
  ...extra,
})

describe('las fechas de la Cancelada', () => {
  it('transición (11.7): con la cuota del 23-oct sin pagar, Cancelada el 31-dic, no antes', () => {
    const pago = proximoPago({ cuotas: CAQUETA, cobros: [PAGO()], hoy: '2026-12-31', ahoraISO: '2026-12-31T12:00:00Z' })
    expect(estadoMora(pago, '2026-12-30', V14, REGLA_MORA_CDA, V15).estado).toBe('restringido')
    expect(estadoMora(pago, '2026-12-31', V14, REGLA_MORA_CDA, V15)).toEqual({ estado: 'suspendido', vencio: '2026-11-30', corteDesde: '2026-12-31' })
  })

  it('primer período v1.5 (23-dic): Suspendida el 29-dic, Cancelada el 23-ene-2027', () => {
    const pago = proximoPago({ cuotas: CAQUETA, cobros: [PAGO(), PAGO(), PAGO()], hoy: '2027-01-23', ahoraISO: '2027-01-23T12:00:00Z' })
    expect(estadoMora(pago, '2026-12-28', V14, REGLA_MORA_CDA, V15).estado).toBe('en_mora')
    expect(estadoMora(pago, '2026-12-29', V14, REGLA_MORA_CDA, V15).estado).toBe('restringido')
    expect(estadoMora(pago, '2027-01-22', V14, REGLA_MORA_CDA, V15).estado).toBe('restringido')
    expect(estadoMora(pago, '2027-01-23', V14, REGLA_MORA_CDA, V15)).toEqual({ estado: 'suspendido', vencio: '2026-12-23', corteDesde: '2027-01-23' })
  })
})

describe('qué se anula (2.5, D4) y qué es cartera (11.7)', () => {
  const estados = cuotasConEstado({ cuotas: CAQUETA, cobros: [PAGO()], hoy: '2026-12-31', ahoraISO: '2026-12-31T12:00:00Z' })

  it('se anula solo el período que empieza desde el 1-dic; los de la transición se deben', () => {
    const r = cuotasParaAnular(estados, V15)
    expect(r.anular.map((c) => c.numero)).toEqual([4])
    expect(r.conAbono).toEqual([])
    expect(carteraDe(estados, V15).map((c) => c.numero)).toEqual([2, 3])
  })

  it('una pagada nunca se anula; con abono parcial no se anula sola (la mira una persona)', () => {
    const conAbono = cuotasConEstado({ cuotas: CAQUETA, cobros: [PAGO(), PAGO(), PAGO(), PAGO(50000)], hoy: '2027-01-23', ahoraISO: '2027-01-23T12:00:00Z' })
    const r = cuotasParaAnular(conAbono, V15)
    expect(r.anular).toEqual([])
    expect(r.conAbono.map((c) => c.numero)).toEqual([4])
    const todas = cuotasConEstado({ cuotas: CAQUETA, cobros: [PAGO(600000)], hoy: '2027-01-23', ahoraISO: '2027-01-23T12:00:00Z' })
    expect(cuotasParaAnular(todas, V15).anular).toEqual([])
  })
})

describe('el plan vigente y lo anterior (D3: el pago de la reactivación no tapa cuotas viejas)', () => {
  const NUEVA = cuota(1, '10-ene', '9-feb', '2027-01-10', { cuotaId: 'n1', planFechaInicio: '2027-01-10' } as Partial<CuotaDeServicio>)
  const ANULADA = { ...CAQUETA[3], anulada: true }

  it('sin reactivación todo es vigente, menos la cuota anulada y el pago de la reactivación sin plan', () => {
    const r = separarPorEpoca({
      cuotas: [...CAQUETA.slice(0, 3), ANULADA],
      cobros: [PAGO(), PAGO(150000, { planFechaInicio: null, esReactivacion: true })],
      reactivadaDesde: null,
    })
    expect(r.vigente.cuotas.map((c) => c.cuotaId)).toEqual(['q1', 'q2', 'q3'])
    expect(r.vigente.cobros).toHaveLength(1)
    expect(r.anterior.cuotas).toEqual([])
  })

  it('con reactivación: el plan nuevo es lo vigente y el pago de la reactivación lo cubre a él', () => {
    const cuotas = [...CAQUETA.slice(0, 3), ANULADA, NUEVA]
    const cobros = [PAGO(), PAGO(150000, { planFechaInicio: '2027-01-10', esReactivacion: true })]
    const r = separarPorEpoca({ cuotas, cobros, reactivadaDesde: '2027-01-10' })
    expect(r.vigente.cuotas.map((c) => c.cuotaId)).toEqual(['n1'])
    expect(proximoPago({ ...r.vigente, hoy: '2027-01-11', ahoraISO: '2027-01-11T12:00:00Z' }).estado).toBe('al_dia')
    const viejas = cuotasConEstado({ ...r.anterior, hoy: '2027-01-11', ahoraISO: '2027-01-11T12:00:00Z' })
    expect(carteraDe(viejas, V15).map((c) => [c.numero, c.saldo])).toEqual([
      [2, 150000],
      [3, 150000],
    ])
    // CONTROL: sin el corte, el pago de la reactivación taparía la cuota del 23-oct y el plan nuevo quedaría sin pagar.
    const sinCorte = proximoPago({ cuotas: [...CAQUETA.slice(0, 3), NUEVA], cobros, hoy: '2027-01-11', ahoraISO: '2027-01-11T12:00:00Z' })
    expect(sinCorte.estado === 'pendiente' && sinCorte.numero).toBe(3)
  })
})

describe('el plan de la reactivación (11.4)', () => {
  it('empieza el día del pago, vence ese día, y se renueva desde su propia fecha', () => {
    const p = planDeReactivacion({ fechaPago: '2027-01-10', montoPeriodo: 150000, precioMensual: 150000, conceptoBase: `${BASE} · periodo del 23-dic al 22-ene` })
    expect(p.plan).toMatchObject({ fecha_inicio: '2027-01-10', fecha_fin: '2027-02-09', total_cuotas: 1, auto_renovar: true, activo: false, monto: 150000 })
    expect(p.cuota).toEqual({ numero: 1, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2027-01-10', concepto_detalle: `${BASE} · periodo del 10-ene al 9-feb` })
    const r = planearRenovacion(
      {
        planId: 'nuevo',
        frecuencia: 'mensual',
        fechaInicio: p.plan.fecha_inicio,
        fechaFin: p.plan.fecha_fin,
        totalCuotas: 1,
        autoRenovar: true,
        conceptoTemplate: p.plan.concepto_detalle_template,
        modulo: 'valida_consulta',
        contratoEstado: 'activo',
        parametros: { precio_mensual: 150000 },
        vigenteHasta: null,
        planAnualEnCurso: false,
        variosPlanes: false,
        cuotas: [{ ...p.cuota, pagada: true }],
      },
      '2027-01-20',
    )
    expect(r).toMatchObject({
      tipo: 'renovar',
      cuota: { numero: 2, fecha_vencimiento: '2027-02-10', concepto_detalle: `${BASE} · periodo del 10-feb al 9-mar` },
    })
  })

  it('un pago el 31: el período va hasta el día anterior al 31 (o al último) del mes siguiente', () => {
    expect(planDeReactivacion({ fechaPago: '2027-01-31', montoPeriodo: 1, precioMensual: 1 }).plan.fecha_fin).toBe('2027-02-27')
  })

  it('el valor de un período: precio mensual más los usuarios adicionales vigentes (2.1 + 2.3)', () => {
    expect(valorDeUnPeriodo({ precio_mensual: 150000 }, [])).toBe(150000)
    expect(valorDeUnPeriodo({ precio_mensual: 150000 }, [{ valorMensual: 50000 }])).toBe(200000)
    expect(valorDeUnPeriodo({}, [])).toBe(null)
  })
})

describe('lo que se dice', () => {
  it('la pantalla, para la persona designada y para los demás', () => {
    expect(textosPantallaCancelada({ canceladaDesde: '2026-12-31', puedeReactivar: true })).toMatchSnapshot()
    expect(textosPantallaCancelada({ canceladaDesde: '2026-12-31', puedeReactivar: false })).toMatchSnapshot()
  })

  it('el correo de la Cancelada, con cartera y con períodos anulados', () => {
    const d = {
      razonSocial: 'CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA',
      canceladaDesde: '2026-12-31',
      urlPagos: 'https://cda-caqueta.metrikone.co/suscripcion?tab=pagos',
      cartera: [
        { periodo: 'del 23 de octubre al 22 de noviembre de 2026', saldo: 150000 },
        { periodo: 'del 23 de noviembre al 22 de diciembre de 2026', saldo: 150000 },
      ],
      hayAnulados: true,
    }
    expect(asuntoCorreoCancelada(d)).toBe('Valida: la suscripción de CENTRO DE DIAGNOSTICO AUTOMOTOR DEL CAQUETA LIMITADA está Cancelada desde el 31 de diciembre de 2026 y se reactiva con el pago de un período')
    expect(textoCorreoCancelada(d)).toMatchSnapshot()
    const sin = textoCorreoCancelada({ ...d, cartera: [], hayAnulados: false })
    expect(sin).not.toContain('11.7')
    expect(sin).not.toContain('2.5')
  })

  it('el correo de la tarjeta afirma el pedido, no el resultado', () => {
    const d = { razonSocial: 'CDA PRUEBA S.A.S.', canceladaDesde: '2026-12-31', ultimos4: '4242' }
    expect(asuntoCorreoTarjetaCancelada(d)).toBe('Valida: pedimos eliminar la tarjeta terminada en 4242 de la suscripción de CDA PRUEBA S.A.S.')
    expect(textoCorreoTarjetaCancelada(d)).toMatchSnapshot()
    expect(htmlCorreoTarjetaCancelada(d)).toContain('<title>Pedimos eliminar tu tarjeta</title>')
  })

  it('el botón del correo de Cancelada se llama como el de la pantalla y lleva a Suscripción', () => {
    const html = htmlCorreoCancelada({ razonSocial: 'X', canceladaDesde: '2026-12-31', urlPagos: 'https://x.metrikone.co/suscripcion?tab=pagos', cartera: [], hayAnulados: false })
    expect(html).toMatch(/href="https:\/\/x\.metrikone\.co\/suscripcion\?tab=pagos"[^>]*>Reactivar la suscripción<\/a>/)
  })

  it('ningún texto amenaza ni invita a irse', () => {
    const todos = [
      JSON.stringify(textosPantallaCancelada({ canceladaDesde: '2026-12-31', puedeReactivar: true })),
      textoCorreoCancelada({ razonSocial: 'X', canceladaDesde: '2026-12-31', urlPagos: 'u', cartera: [{ periodo: 'p', saldo: 1 }], hayAnulados: true }),
      textoCorreoTarjetaCancelada({ razonSocial: 'X', canceladaDesde: '2026-12-31', ultimos4: null }),
    ].join(' ')
    for (const prohibido of [/reportad/i, /centrales/i, /jur[ií]dic/i, /embargo/i, /intereses de mora/i, /retirar/i, /darte de baja/i, /premium/i]) {
      expect(todos).not.toMatch(prohibido)
    }
  })
})
