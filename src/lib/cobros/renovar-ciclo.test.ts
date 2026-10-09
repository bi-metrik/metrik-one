/**
 * La renovación continua de Valida. Esto es plata: cada caso de aquí es uno que, si se rompe, le
 * cobra a un cliente que se fue, le cobra dos veces el mismo mes o deja de cobrarle a uno que sigue.
 *
 * El calendario de referencia es el REAL de los CDA cargados a mano el 2026-09-23 (C1, C2, C3):
 * inicio el 23-sep, cuota 1 el 30-sep, las demás el 27 de cada mes, periodos del 23 al 22.
 */
import { describe, expect, it } from 'vitest'
import { leerPeriodoEnConcepto } from './periodo-en-concepto'
import {
  HORIZONTE_RENOVACION_DIAS,
  mesDelPlan,
  planearRenovacion,
  type CuotaDelPlan,
  type PlanCandidatoRenovacion,
} from './renovar-ciclo'

const CONCEPTO = 'Suscripción VALIDA · Plan CDA — servicio de computación en la nube (SaaS)'
const cuota = (numero: number, vence: string, periodo: string, pagada = false): CuotaDelPlan => ({
  numero,
  tipo: 'cuota',
  monto: 150_000,
  fecha_vencimiento: vence,
  concepto_detalle: `${CONCEPTO} · periodo del ${periodo}`,
  pagada,
})

const CUOTAS_CDA = [
  cuota(1, '2026-09-30', '23-sep al 22-oct', true),
  cuota(2, '2026-10-27', '23-oct al 22-nov', true),
  cuota(3, '2026-11-27', '23-nov al 22-dic', true),
  cuota(4, '2026-12-27', '23-dic al 22-ene'),
]

const CDA: PlanCandidatoRenovacion = {
  planId: 'plan-c1',
  frecuencia: 'mensual',
  fechaInicio: '2026-09-23',
  fechaFin: '2027-01-22',
  totalCuotas: 4,
  autoRenovar: true,
  conceptoTemplate: CONCEPTO,
  modulo: 'valida_consulta',
  contratoEstado: 'activo',
  parametros: { licencias: 2, precio_mensual: 150_000 },
  vigenteHasta: null,
  planAnualEnCurso: false,
  variosPlanes: false,
  cuotas: CUOTAS_CDA,
}

const renovar = (hoy: string, c: Partial<PlanCandidatoRenovacion> = {}) => planearRenovacion({ ...CDA, ...c }, hoy)

describe('la cuota siguiente de un CDA', () => {
  it('con la última cuota lejos, no se agrega nada', () => {
    expect(renovar('2026-10-09')).toEqual({ tipo: 'no', motivo: 'horizonte_cubierto' })
    // El día exacto en que la última (27-dic) queda a 30 días todavía no renueva…
    expect(renovar('2026-11-27')).toEqual({ tipo: 'no', motivo: 'horizonte_cubierto' })
  })

  it('…y el día siguiente agrega la 5: vence el 27-ene y paga del 23-ene al 22-feb', () => {
    const r = renovar('2026-11-28')
    expect(r.tipo).toBe('renovar')
    if (r.tipo !== 'renovar') return
    expect(r.cuota).toEqual({
      numero: 5,
      tipo: 'cuota',
      monto: 150_000,
      fecha_vencimiento: '2027-01-27',
      concepto_detalle: `${CONCEPTO} · periodo del 23-ene al 22-feb`,
    })
    expect(r.totalCuotas).toBe(5)
    expect(r.fechaFin).toBe('2027-02-22')
    // El periodo se lee igual que el de las cuotas cargadas a mano.
    expect(leerPeriodoEnConcepto(r.cuota.concepto_detalle, r.cuota.fecha_vencimiento)).toMatchObject({
      desde: '2027-01-23',
      hasta: '2027-02-22',
    })
  })

  it('agrega UNA sola cuota: con la 5 ya puesta, el mismo día no agrega la 6', () => {
    const r = renovar('2026-11-28')
    if (r.tipo !== 'renovar') throw new Error('debía renovar')
    const conLa5 = [...CUOTAS_CDA, { ...r.cuota, pagada: false }]
    expect(renovar('2026-11-28', { cuotas: conLa5 })).toEqual({ tipo: 'no', motivo: 'horizonte_cubierto' })
    // Un mes después sí toca la 6, el 27-feb.
    const r6 = renovar('2026-12-29', { cuotas: conLa5.map((c) => ({ ...c, pagada: true })) })
    expect(r6).toMatchObject({ tipo: 'renovar', cuota: { numero: 6, fecha_vencimiento: '2027-02-27' } })
  })

  it('Maxitec (3 cuotas) recibe la 4 el 29-oct, con vencimiento el 27-dic', () => {
    expect(renovar('2026-10-28', { cuotas: CUOTAS_CDA.slice(0, 3) }).tipo).toBe('no')
    const r = renovar('2026-10-29', { cuotas: CUOTAS_CDA.slice(0, 3), totalCuotas: 3, fechaFin: '2026-12-22' })
    expect(r).toMatchObject({
      tipo: 'renovar',
      cuota: { numero: 4, fecha_vencimiento: '2026-12-27', concepto_detalle: `${CONCEPTO} · periodo del 23-dic al 22-ene` },
      totalCuotas: 4,
      fechaFin: '2027-01-22',
    })
  })

  it('el monto es el pactado en el contrato, no el de la cuota anterior', () => {
    const r = renovar('2026-11-28', { parametros: { precio_mensual: 120_000 } })
    expect(r).toMatchObject({ tipo: 'renovar', cuota: { monto: 120_000 } })
  })

  it('un plan enrolado por trial (vence el primer día del periodo) sigue igual tras la cuota 12', () => {
    const inicio = '2026-10-16'
    const cuotas: CuotaDelPlan[] = Array.from({ length: 12 }, (_, i) => {
      const desde = new Date(Date.UTC(2026, 9 + i, 16)).toISOString().slice(0, 10)
      const hasta = new Date(Date.UTC(2026, 10 + i, 15)).toISOString().slice(0, 10)
      const dm = (iso: string) => `${Number(iso.slice(8))}-${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][Number(iso.slice(5, 7)) - 1]}`
      return { numero: i + 1, tipo: 'cuota', monto: 150_000, fecha_vencimiento: desde, concepto_detalle: `Suscripción Licencia Valida por CDA · periodo del ${dm(desde)} al ${dm(hasta)}`, pagada: true }
    })
    const r = renovar('2027-09-20', { fechaInicio: inicio, fechaFin: '2027-10-15', totalCuotas: 12, cuotas })
    expect(r).toMatchObject({
      tipo: 'renovar',
      cuota: { numero: 13, fecha_vencimiento: '2027-10-16', concepto_detalle: 'Suscripción Licencia Valida por CDA · periodo del 16-oct al 15-nov' },
    })
  })
})

describe('las barreras: todas del lado de no cobrar', () => {
  const tocaRenovar = '2026-11-28'

  it('solo Valida: otro módulo no se renueva aunque tenga auto_renovar', () => {
    for (const modulo of ['business', 'compliance', 'radar_secop', null]) {
      expect(renovar(tocaRenovar, { modulo }), String(modulo)).toEqual({ tipo: 'no', motivo: 'modulo_no_automatico' })
    }
  })

  it('sin auto_renovar no hay renovación: así se da de baja', () => {
    expect(renovar(tocaRenovar, { autoRenovar: false })).toEqual({ tipo: 'no', motivo: 'sin_auto_renovar' })
  })

  it('solo un contrato activo: pausado, cancelado, terminado o sin contrato no renuevan', () => {
    for (const contratoEstado of ['pausado', 'cancelado', 'terminado', 'borrador', null]) {
      expect(renovar(tocaRenovar, { contratoEstado }), String(contratoEstado)).toEqual({ tipo: 'no', motivo: 'estado' })
    }
  })

  it('la baja con fecha: no nace un periodo que arranca después de vigente_hasta', () => {
    expect(renovar(tocaRenovar, { vigenteHasta: '2027-01-22' })).toEqual({ tipo: 'no', motivo: 'vigencia_terminada' })
    // El periodo que arranca justo ese día sí se cobra: el servicio lo cubre.
    expect(renovar(tocaRenovar, { vigenteHasta: '2027-01-23' }).tipo).toBe('renovar')
  })

  it('en mora: una cuota vencida hace más de 5 días sin pagar frena (El Carmen)', () => {
    const elCarmen = CUOTAS_CDA.map((c) => ({ ...c, pagada: false }))
    expect(renovar(tocaRenovar, { cuotas: elCarmen })).toEqual({ tipo: 'no', motivo: 'en_mora' })
    // Dentro de la gracia todavía no es mora.
    const alDia = CUOTAS_CDA.map((c) => ({ ...c, pagada: c.numero !== 4 }))
    expect(renovar('2026-11-28', { cuotas: alDia }).tipo).toBe('renovar')
  })

  it('con el plan anual en curso no se agrega la cuota mensual (sería doble cobro)', () => {
    expect(renovar(tocaRenovar, { planAnualEnCurso: true })).toEqual({ tipo: 'no', motivo: 'plan_anual' })
  })

  it('dos planes con auto_renovar en el mismo negocio: no se adivina cuál', () => {
    expect(renovar(tocaRenovar, { variosPlanes: true })).toEqual({ tipo: 'no', motivo: 'varios_planes' })
  })

  it('nunca nace una cuota ya vencida: el cron caído no cobra meses atrasados', () => {
    // La 4 venció el 27-dic y nadie renovó: el 5-feb la 5 (27-ene) ya pasó.
    const pagadas = CUOTAS_CDA.map((c) => ({ ...c, pagada: true }))
    expect(renovar('2027-02-05', { cuotas: pagadas })).toEqual({ tipo: 'no', motivo: 'siguiente_vencida' })
  })

  it('sin precio pactado no se inventa uno', () => {
    expect(renovar(tocaRenovar, { parametros: { licencias: 2 } })).toEqual({ tipo: 'no', motivo: 'sin_precio' })
    expect(renovar(tocaRenovar, { parametros: { precio_mensual: 0 } })).toEqual({ tipo: 'no', motivo: 'sin_precio' })
  })

  it('un calendario que no cuadra con fecha_inicio va a una persona', () => {
    // El concepto dice que la cuota 4 paga desde el 1-dic, pero el plan arranca el 23.
    const raro = [...CUOTAS_CDA.slice(0, 3), cuota(4, '2026-12-27', '1-dic al 31-dic')]
    expect(renovar(tocaRenovar, { cuotas: raro })).toEqual({ tipo: 'no', motivo: 'calendario_irregular' })
  })

  it('solo la serie mensual cuenta; las demás cuotas no se renuevan pero sí reservan su número', () => {
    const conAdicional = [...CUOTAS_CDA, { ...cuota(7, '2026-10-30', '23-oct al 22-nov', true), tipo: 'usuarios_adicionales' }]
    expect(renovar(tocaRenovar, { cuotas: conAdicional })).toMatchObject({ tipo: 'renovar', cuota: { numero: 8, fecha_vencimiento: '2027-01-27' } })
    expect(renovar(tocaRenovar, { cuotas: [] })).toEqual({ tipo: 'no', motivo: 'sin_cuotas' })
  })

  it('frecuencia distinta de mensual no se renueva', () => {
    expect(renovar(tocaRenovar, { frecuencia: 'anual' })).toEqual({ tipo: 'no', motivo: 'frecuencia' })
  })
})

describe('mesDelPlan', () => {
  it('ubica la fecha en su mes del calendario del plan', () => {
    expect(mesDelPlan('2026-09-23', '2026-09-30')).toBe(0)
    expect(mesDelPlan('2026-09-23', '2026-10-22')).toBe(0)
    expect(mesDelPlan('2026-09-23', '2026-10-23')).toBe(1)
    expect(mesDelPlan('2026-09-23', '2026-12-27')).toBe(3)
  })

  it('el horizonte deja margen sobre la ventana del enlace (7 días)', () => {
    expect(HORIZONTE_RENOVACION_DIAS).toBeGreaterThan(7)
  })
})
