import { describe, expect, it } from 'vitest'
import { planearRenovacion, type PlanCandidatoRenovacion } from '@/lib/cobros/renovar-ciclo'
import type { CuotaConEstado } from './pago-pendiente'
import {
  diaBogota,
  noVendidas,
  periodoSeVende,
  reactivacionExigeV15,
  suscripcionNoContinua,
  textosBloquePagarPeriodo,
  textoCorreoPrestado,
  VENTA_SIN_V15,
} from './venta-16-4'

const MAXITEC = { base: '2026-12-22', aceptadaEl: null }
const CAQUETA = { base: '2027-01-16', aceptadaEl: null }
const BASE = 'Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS)'

const estado = (numero: number, vence: string, periodo: string, abonado: number): CuotaConEstado => ({
  cuotaId: `q${numero}`,
  numero,
  concepto: `${BASE} · periodo del ${periodo}`,
  fechaVencimiento: vence,
  monto: 150000,
  abonado,
  saldo: 150000 - abonado,
  estado: abonado >= 150000 ? 'pagada' : 'pendiente',
  enlacePago: null,
  factura: null,
})

describe('periodoSeVende (16.4 por el inicio del período)', () => {
  it('antes de la base se vende; desde la base, solo con la v1.5 aceptada a más tardar el día que empieza', () => {
    expect(periodoSeVende(MAXITEC, '2026-11-23')).toBe(true)
    expect(periodoSeVende(MAXITEC, '2026-12-22')).toBe(false)
    expect(periodoSeVende(MAXITEC, '2026-12-23')).toBe(false)
    expect(periodoSeVende(CAQUETA, '2026-12-23')).toBe(true)
    expect(periodoSeVende(CAQUETA, '2027-01-23')).toBe(false)
    expect(periodoSeVende({ ...MAXITEC, aceptadaEl: '2026-12-23' }, '2026-12-23')).toBe(true)
    expect(periodoSeVende({ ...MAXITEC, aceptadaEl: '2026-12-24' }, '2026-12-23')).toBe(false)
    expect(periodoSeVende(VENTA_SIN_V15, '2030-01-01')).toBe(true)
  })

  it('el día de la aceptación es el de Bogotá', () => {
    expect(diaBogota('2026-12-23T04:59:00Z')).toBe('2026-12-22')
    expect(diaBogota('2026-12-23T05:00:00Z')).toBe('2026-12-23')
    expect(diaBogota(null)).toBe(null)
  })
})

describe('noVendidas', () => {
  it('la cuota sin abono de un período no vendido, y las que siguen; la pagada se presta', () => {
    const cuotas = [
      estado(3, '2026-11-27', '23-nov al 22-dic', 150000),
      estado(4, '2026-12-27', '23-dic al 22-ene', 0),
      estado(5, '2027-01-27', '23-ene al 22-feb', 0),
    ]
    expect(noVendidas(cuotas, MAXITEC).map((c) => c.numero)).toEqual([4, 5])
    expect(noVendidas(cuotas, CAQUETA).map((c) => c.numero)).toEqual([5])
    // Aceptada después del 23-dic: la 4 no se vendió y la 5 tampoco (la suscripción no continuó).
    expect(noVendidas(cuotas, { ...MAXITEC, aceptadaEl: '2027-01-10' }).map((c) => c.numero)).toEqual([4, 5])
    const pagada = [estado(4, '2026-12-27', '23-dic al 22-ene', 150000)]
    expect(noVendidas(pagada, MAXITEC)).toEqual([])
    const abonada = [estado(4, '2026-12-27', '23-dic al 22-ene', 50000)]
    expect(noVendidas(abonada, MAXITEC)).toEqual([])
  })
})

describe('reactivacionExigeV15 (11.4 + 16.4)', () => {
  it('solo desde la base y sin la v1.5 aceptada', () => {
    expect(reactivacionExigeV15(CAQUETA, '2027-01-15')).toBe(false)
    expect(reactivacionExigeV15(CAQUETA, '2027-01-16')).toBe(true)
    expect(reactivacionExigeV15({ ...CAQUETA, aceptadaEl: '2027-01-20' }, '2027-01-20')).toBe(false)
    expect(reactivacionExigeV15(MAXITEC, '2026-12-31')).toBe(true)
    expect(reactivacionExigeV15(VENTA_SIN_V15, '2030-01-01')).toBe(false)
  })
})

describe('suscripcionNoContinua', () => {
  const vendidas = [
    { concepto: `${BASE} · periodo del 23-nov al 22-dic`, fechaVencimiento: '2026-11-27' },
  ]
  it('aceptada tarde y sin período vendido que cubra hoy: no continúa', () => {
    expect(suscripcionNoContinua({ venta: { ...MAXITEC, aceptadaEl: '2027-01-10' }, hoy: '2027-01-10', vendidas })).toBe(true)
  })
  it('sin aceptar (manda la exigencia), aceptada antes de la base, o con un período que cubre hoy: continúa', () => {
    expect(suscripcionNoContinua({ venta: MAXITEC, hoy: '2027-01-10', vendidas })).toBe(false)
    expect(suscripcionNoContinua({ venta: { ...MAXITEC, aceptadaEl: '2026-12-20' }, hoy: '2027-01-10', vendidas })).toBe(false)
    const conEnero = [...vendidas, { concepto: `${BASE} · periodo del 23-dic al 22-ene`, fechaVencimiento: '2026-12-27' }]
    expect(suscripcionNoContinua({ venta: { ...MAXITEC, aceptadaEl: '2027-01-10' }, hoy: '2027-01-10', vendidas: conEnero })).toBe(false)
  })
})

describe('la renovación no crea la cuota de un período que no se vende', () => {
  const plan = (venta: PlanCandidatoRenovacion['ventaV15']): PlanCandidatoRenovacion => ({
    planId: 'plan',
    frecuencia: 'mensual',
    fechaInicio: '2026-09-23',
    fechaFin: '2027-01-22',
    totalCuotas: 4,
    autoRenovar: true,
    conceptoTemplate: BASE,
    modulo: 'valida_consulta',
    contratoEstado: 'activo',
    parametros: { precio_mensual: 150000 },
    vigenteHasta: null,
    planAnualEnCurso: false,
    variosPlanes: false,
    cuotas: [
      { numero: 3, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-11-27', concepto_detalle: `${BASE} · periodo del 23-nov al 22-dic`, pagada: true },
      { numero: 4, tipo: 'cuota', monto: 150000, fecha_vencimiento: '2026-12-27', concepto_detalle: `${BASE} · periodo del 23-dic al 22-ene`, pagada: false },
    ],
    ventaV15: venta,
  })
  it('Caquetá sin aceptar (28-nov): la cuota del 23-ene no nace; aceptada, sí', () => {
    expect(planearRenovacion(plan(CAQUETA), '2026-11-28')).toEqual({ tipo: 'no', motivo: 'v15_sin_aceptar' })
    expect(planearRenovacion(plan({ ...CAQUETA, aceptadaEl: '2026-11-20' }), '2026-11-28')).toMatchObject({
      tipo: 'renovar',
      cuota: { numero: 5, concepto_detalle: `${BASE} · periodo del 23-ene al 22-feb` },
    })
    // Sin la 16.4 (otro servicio, o sin v1.5), como siempre.
    expect(planearRenovacion(plan(null), '2026-11-28').tipo).toBe('renovar')
  })
})

describe('textos nuevos', () => {
  it('el bloque de Suscripción y el correo del período prestado', () => {
    expect(textosBloquePagarPeriodo({ monto: 150000 })).toEqual({
      titulo: 'Pagar un período',
      detalle:
        'Pagas un período de $150.000. Corre desde el día del pago, que pasa a ser tu nueva fecha de renovación, y con el pago vuelven las consultas.',
      cartera: null,
      boton: 'Pagar un período desde hoy',
    })
    expect(
      textoCorreoPrestado({ razonSocial: 'MAXITEC S.A.S.', desde: '2026-12-23', hasta: '2027-01-22', urlValida: 'https://maxitec.metrikone.co/valida' }),
    ).toMatchSnapshot()
  })
})
