import { describe, expect, it } from 'vitest'
import {
  asignarCargosCompra,
  cargosALiberar,
  conceptoBase,
  conceptoConDesglose,
  diaInicioDeContrato,
  periodoDe,
  periodoDeCuota,
  prorrata,
  sumaPorCuota,
  type CargoVivo,
  type CuotaDelPlan,
} from './periodos'

/**
 * Los periodos del 23 al 22 de los CDA y el cobro del usuario adicional ($50.000, cláusula 2.3).
 * Las cuotas de los CDA vencen el 30-sep, el 27-oct y el 27-nov (medidas en producción el 2026-09-23).
 */

const D = 23
const V = 50000

describe('periodo del 23 al 22', () => {
  it('el día de inicio sale del contrato', () => {
    expect(diaInicioDeContrato('2026-09-23')).toBe(23)
  })

  it('un día del 23 en adelante está en el periodo que empieza ese mes', () => {
    expect(periodoDe('2026-09-23', D)).toEqual({ desde: '2026-09-23', hasta: '2026-10-22', dias: 30 })
    expect(periodoDe('2026-09-30', D)).toEqual({ desde: '2026-09-23', hasta: '2026-10-22', dias: 30 })
  })

  it('un día antes del 23 está en el periodo que empezó el mes anterior', () => {
    expect(periodoDe('2026-10-22', D)).toEqual({ desde: '2026-09-23', hasta: '2026-10-22', dias: 30 })
    expect(periodoDe('2026-10-01', D)).toEqual({ desde: '2026-09-23', hasta: '2026-10-22', dias: 30 })
  })

  it('mes de 31 días: del 23-oct al 22-nov son 31', () => {
    expect(periodoDe('2026-11-05', D)).toEqual({ desde: '2026-10-23', hasta: '2026-11-22', dias: 31 })
  })

  it('cruce de año: del 23-dic al 22-ene', () => {
    expect(periodoDe('2026-12-30', D)).toEqual({ desde: '2026-12-23', hasta: '2027-01-22', dias: 31 })
    expect(periodoDe('2027-01-10', D)).toEqual({ desde: '2026-12-23', hasta: '2027-01-22', dias: 31 })
  })

  it('febrero: del 23-ene al 22-feb son 31, del 23-feb al 22-mar son 28 (29 en bisiesto)', () => {
    expect(periodoDe('2027-02-01', D).dias).toBe(31)
    expect(periodoDe('2027-03-01', D)).toEqual({ desde: '2027-02-23', hasta: '2027-03-22', dias: 28 })
    expect(periodoDe('2028-03-01', D).dias).toBe(29)
  })

  it('un día de inicio que el mes no tiene se corre al último día', () => {
    expect(periodoDe('2027-02-28', 31)).toEqual({ desde: '2027-02-28', hasta: '2027-03-30', dias: 31 })
    expect(periodoDe('2027-02-27', 31)).toEqual({ desde: '2027-01-31', hasta: '2027-02-27', dias: 28 })
  })
})

describe('prorrata del usuario adicional', () => {
  it('comprado el 23 (primer día) vale el periodo entero', () => {
    expect(prorrata('2026-09-23', D, V)).toMatchObject({ dias: 30, monto: 50000 })
  })

  it('comprado el 22 (último día) vale un día', () => {
    // 50.000 / 30 = 1.666,67 → 1.667
    expect(prorrata('2026-10-22', D, V)).toMatchObject({ dias: 1, monto: 1667 })
  })

  it('periodo de 30 días: el 24-sep quedan 29', () => {
    // 50.000 × 29 / 30 = 48.333,33
    expect(prorrata('2026-09-24', D, V)).toMatchObject({ dias: 29, monto: 48333 })
  })

  it('periodo de 31 días: el 1-nov quedan 22 de 31', () => {
    // 50.000 × 22 / 31 = 35.483,87
    expect(prorrata('2026-11-01', D, V)).toMatchObject({ dias: 22, monto: 35484 })
  })

  it('cruce de año: el 31-dic quedan 23 de 31', () => {
    expect(prorrata('2026-12-31', D, V)).toMatchObject({
      periodo: { desde: '2026-12-23', hasta: '2027-01-22', dias: 31 },
      dias: 23,
      monto: 37097,
    })
  })

  it('el valor es del contrato: con otro valor, otro número', () => {
    expect(prorrata('2026-09-24', D, 60000).monto).toBe(58000)
  })

  it('un valor inválido no calcula', () => {
    expect(() => prorrata('2026-09-24', D, 0)).toThrow()
    expect(() => prorrata('2026-09-24', D, Number.NaN)).toThrow()
  })
})

describe('el periodo de una cuota', () => {
  it('lo dice el concepto cuando lo trae', () => {
    expect(
      periodoDeCuota({ concepto: 'Licencia VALIDA · Starter — periodo del 23/10/2026 al 22/11/2026', fechaVencimiento: '2026-10-27' }, D),
    ).toEqual({ desde: '2026-10-23', hasta: '2026-11-22', dias: 31 })
  })

  it('sin concepto, el periodo que contiene el vencimiento', () => {
    expect(periodoDeCuota({ concepto: null, fechaVencimiento: '2026-09-30' }, D).desde).toBe('2026-09-23')
  })
})

const cuota = (numero: number, fechaVencimiento: string, modificable = true, monto = 150000): CuotaDelPlan => ({
  id: `q${numero}`,
  numero,
  monto,
  concepto: null,
  fechaVencimiento,
  modificable,
})
const PLAN = [cuota(1, '2026-09-30', false), cuota(2, '2026-10-27'), cuota(3, '2026-11-27'), cuota(4, '2026-12-27')]

describe('asignar los cargos de una compra', () => {
  it('se cobra en la SIGUIENTE cuota: prorrata del periodo en curso + el periodo siguiente, y cada periodo en su cuota', () => {
    const r = asignarCargosCompra({ fecha: '2026-09-24', diaInicio: D, valorMensual: V, cuotas: PLAN })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.primeraCuota.numero).toBe(2)
    expect(r.cargos.map((c) => [c.cuotaNumero, c.tipo, c.periodoDesde, c.monto])).toEqual([
      [2, 'prorrata', '2026-09-24', 48333],
      [2, 'periodo', '2026-10-23', 50000],
      [3, 'periodo', '2026-11-23', 50000],
      [4, 'periodo', '2026-12-23', 50000],
    ])
    expect(Object.fromEntries(sumaPorCuota(r.cargos))).toEqual({ q2: 98333, q3: 50000, q4: 50000 })
  })

  it('la cuota del periodo en curso no lleva nada aunque todavía se pueda tocar', () => {
    const plan = [cuota(1, '2026-09-30', true), cuota(2, '2026-10-27')]
    const r = asignarCargosCompra({ fecha: '2026-09-23', diaInicio: D, valorMensual: V, cuotas: plan })
    expect(r.ok && r.cargos.every((c) => c.cuotaId === 'q2')).toBe(true)
  })

  it('una cuota ya cobrada no se toca: su cargo y la prorrata se corren a la primera modificable', () => {
    const plan = [cuota(1, '2026-09-30', false), cuota(2, '2026-10-27', false), cuota(3, '2026-11-27')]
    const r = asignarCargosCompra({ fecha: '2026-10-20', diaInicio: D, valorMensual: V, cuotas: plan })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.cargos.every((c) => c.cuotaId === 'q3')).toBe(true)
    expect(r.cargos.map((c) => [c.tipo, c.periodoDesde, c.monto])).toEqual([
      ['prorrata', '2026-10-20', 5000],
      ['periodo', '2026-10-23', 50000],
      ['periodo', '2026-11-23', 50000],
    ])
  })

  it('comprada el 22 (último día): un día de prorrata y el periodo siguiente', () => {
    const r = asignarCargosCompra({ fecha: '2026-10-22', diaInicio: D, valorMensual: V, cuotas: PLAN })
    expect(r.ok && r.cargos.filter((c) => c.cuotaId === 'q2').map((c) => c.monto)).toEqual([1667, 50000])
  })

  it('cruce de año: comprada el 31-dic se cobra en la cuota del 23-ene', () => {
    const plan = [cuota(4, '2026-12-27', false), cuota(5, '2027-01-27')]
    const r = asignarCargosCompra({ fecha: '2026-12-31', diaInicio: D, valorMensual: V, cuotas: plan })
    expect(r.ok && r.cargos.map((c) => [c.cuotaNumero, c.monto])).toEqual([
      [5, 37097],
      [5, 50000],
    ])
  })

  it('sin ninguna cuota modificable después del periodo en curso, la compra no se registra', () => {
    const plan = [cuota(1, '2026-09-30'), cuota(2, '2026-10-27', false)]
    expect(asignarCargosCompra({ fecha: '2026-09-24', diaInicio: D, valorMensual: V, cuotas: plan })).toEqual({
      ok: false,
      motivo: 'sin_cuota_modificable',
    })
  })
})

describe('retirar una licencia adicional', () => {
  const r = asignarCargosCompra({ fecha: '2026-09-24', diaInicio: D, valorMensual: V, cuotas: PLAN })
  const vivos: CargoVivo[] = r.ok ? r.cargos.map((c, i) => ({ ...c, id: `c${i}` })) : []

  it('deja de cobrarse desde el periodo siguiente al del retiro', () => {
    const x = cargosALiberar({ fecha: '2026-10-10', diaInicio: D, cargos: vivos, cuotasModificables: new Set(['q2', 'q3', 'q4']) })
    // Retiro en el periodo 23-sep/22-oct: el periodo que empieza el 23-oct ya no se cobra.
    expect(x.anular.map((c) => c.periodoDesde)).toEqual(['2026-10-23', '2026-11-23', '2026-12-23'])
    expect(x.seQuedan.map((c) => c.tipo)).toEqual(['prorrata'])
  })

  it('retirada el 25-oct: el periodo en curso (23-oct) se sigue cobrando', () => {
    const x = cargosALiberar({ fecha: '2026-10-25', diaInicio: D, cargos: vivos, cuotasModificables: new Set(['q2', 'q3', 'q4']) })
    expect(x.anular.map((c) => c.periodoDesde)).toEqual(['2026-11-23', '2026-12-23'])
  })

  it('un cargo en una cuota que ya se cobró se queda', () => {
    const x = cargosALiberar({ fecha: '2026-10-10', diaInicio: D, cargos: vivos, cuotasModificables: new Set(['q4']) })
    expect(x.anular.map((c) => c.cuotaId)).toEqual(['q4'])
  })
})

describe('el concepto con el desglose', () => {
  const base = 'Licencia VALIDA · Starter — periodo del 23/10/2026 al 22/11/2026'

  it('agrega el desglose y se puede volver a la base', () => {
    const r = asignarCargosCompra({ fecha: '2026-09-24', diaInicio: D, valorMensual: V, cuotas: PLAN })
    const deQ2 = r.ok ? r.cargos.filter((c) => c.cuotaId === 'q2') : []
    const texto = conceptoConDesglose(base, deQ2)
    expect(texto).toBe(
      `${base} · Incluye: 1 usuario adicional, prorrata del 24/09/2026 al 22/10/2026 (29 de 30 días) $48.333; ` +
        '1 usuario adicional, periodo del 23/10/2026 al 22/11/2026 $50.000',
    )
    expect(conceptoBase(texto)).toBe(base)
  })

  it('dos licencias del mismo periodo se agrupan', () => {
    const c = { tipo: 'periodo' as const, periodoDesde: '2026-10-23', periodoHasta: '2026-11-22', dias: 31, diasPeriodo: 31, monto: V }
    expect(conceptoConDesglose(base, [c, c])).toContain('2 usuarios adicionales, periodo del 23/10/2026 al 22/11/2026 $100.000')
  })

  it('sin cargos queda la base', () => {
    expect(conceptoConDesglose(base, [])).toBe(base)
    expect(conceptoBase(base)).toBe(base)
    expect(conceptoBase(null)).toBeNull()
  })
})
