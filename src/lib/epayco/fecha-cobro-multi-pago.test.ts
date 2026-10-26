/**
 * La fecha de los cobros de BloqueDatosMultiPago es la del PAGO en ePayco (sigue a SOE-013).
 * Puro: la consulta, el módulo y «hoy» son dobles.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  refPaycoDe,
  fechasDeCobrosMulti,
  notaCobroMulti,
  fechasDePagosMulti,
} from './fecha-cobro-multi-pago'

const HOY = '2026-10-02'

function deps(over: Partial<Parameters<typeof fechasDeCobrosMulti>[1]> = {}) {
  return {
    puedeConsultar: vi.fn(async () => true),
    // 16-sep 20:15 en Bogotá ya es 17-sep en UTC: si la conversión falla, se ve.
    consultar: vi.fn(async (_ref: number) => ({ fecha: '2026-09-16 20:15:00' })),
    hoy: HOY,
    ...over,
  }
}

describe('refPaycoDe', () => {
  it('acepta solo enteros positivos', () => {
    expect(refPaycoDe(' 386159602 ')).toBe(386159602)
    expect(refPaycoDe('REF-12345')).toBeNull()
    expect(refPaycoDe('EXT-1')).toBeNull()
    expect(refPaycoDe('')).toBeNull()
    expect(refPaycoDe('0')).toBeNull()
    expect(refPaycoDe('12.5')).toBeNull()
  })
})

describe('fechasDeCobrosMulti', () => {
  it('la fecha es la del pago en ePayco, en día civil de Bogotá', async () => {
    const d = deps()
    expect(await fechasDeCobrosMulti(['386159602'], d)).toEqual([{ fecha: '2026-09-16', dePago: true }])
    expect(d.consultar).toHaveBeenCalledWith(386159602)
  })

  it('fecha ilegible: el día del registro, marcado', async () => {
    const d = deps({ consultar: vi.fn(async () => ({ fecha: 'ayer por la tarde' })) })
    expect(await fechasDeCobrosMulti(['386159602'], d)).toEqual([{ fecha: HOY, dePago: false }])
  })

  it('ePayco falla: el día del registro, sin lanzar', async () => {
    const d = deps({ consultar: vi.fn(async () => { throw new Error('ePayco caído') }) })
    expect(await fechasDeCobrosMulti(['386159602'], d)).toEqual([{ fecha: HOY, dePago: false }])
  })

  it('ePayco no responde a tiempo: el día del registro', async () => {
    const d = deps({ consultar: vi.fn(() => new Promise<{ fecha: string }>(() => {})), plazoMs: 10 })
    expect(await fechasDeCobrosMulti(['386159602'], d)).toEqual([{ fecha: HOY, dePago: false }])
  })

  it('un workspace que no cobra por ePayco no consulta la cuenta global', async () => {
    const d = deps({ puedeConsultar: vi.fn(async () => false) })
    expect(await fechasDeCobrosMulti(['386159602'], d)).toEqual([{ fecha: HOY, dePago: false }])
    expect(d.consultar).not.toHaveBeenCalled()
  })

  it('una referencia que no es de ePayco ni pregunta por el módulo', async () => {
    const d = deps()
    expect(await fechasDeCobrosMulti(['REF-1'], d)).toEqual([{ fecha: HOY, dePago: false }])
    expect(d.puedeConsultar).not.toHaveBeenCalled()
    expect(d.consultar).not.toHaveBeenCalled()
  })

  it('mezcla: cada fila con lo suyo, y una referencia repetida se consulta una vez', async () => {
    const d = deps({
      consultar: vi.fn(async (ref: number) => ({ fecha: ref === 1 ? '2026-09-01 10:00:00' : null })),
    })
    expect(await fechasDeCobrosMulti(['1', 'REF-2', '1', '3'], d)).toEqual([
      { fecha: '2026-09-01', dePago: true },
      { fecha: HOY, dePago: false },
      { fecha: '2026-09-01', dePago: true },
      { fecha: HOY, dePago: false },
    ])
    expect(d.consultar).toHaveBeenCalledTimes(2)
  })
})

describe('notaCobroMulti', () => {
  it('con fecha del pago, la nota de siempre; sin ella, lo dice', () => {
    expect(notaCobroMulti('386159602', true)).toBe('Pago')
    expect(notaCobroMulti('386159602', false)).toBe(
      'Pago — fecha de registro: ePayco no devolvio una fecha legible para la ref 386159602',
    )
  })
})

describe('fechasDePagosMulti', () => {
  const cobro = (external_ref: string, monto: number, fecha: string) =>
    ({ external_ref, monto, fecha, tipo_cobro: 'pago' })

  it('cada fila toma el cobro con su referencia y su valor', () => {
    expect(
      fechasDePagosMulti(
        [{ referencia_epayco: '1', valor_pago: 100 }, { referencia_epayco: '2', valor_pago: 200 }],
        [cobro('2', 200, '2026-09-02'), cobro('1', 100, '2026-09-01')],
      ),
    ).toEqual(['2026-09-01', '2026-09-02'])
  })

  it('dos abonos iguales toman un cobro cada uno; sin cobro, sin fecha', () => {
    const pagos = [
      { referencia_epayco: '1', valor_pago: 100 },
      { referencia_epayco: '1', valor_pago: 100 },
      { referencia_epayco: '1', valor_pago: 100 },
    ]
    expect(fechasDePagosMulti(pagos, [cobro('1', 100, '2026-09-01'), cobro('1', 100, '2026-09-05')]))
      .toEqual(['2026-09-01', '2026-09-05', null])
  })

  it('no toma el cobro de otro valor, ni uno que no es de tipo pago, ni una fila vacía', () => {
    expect(fechasDePagosMulti([{ referencia_epayco: '1', valor_pago: 100 }], [cobro('1', 90, '2026-09-01')])).toEqual([null])
    expect(fechasDePagosMulti(
      [{ referencia_epayco: '1', valor_pago: 100 }],
      [{ external_ref: '1', monto: 100, fecha: '2026-09-01', tipo_cobro: 'anticipo' }],
    )).toEqual([null])
    expect(fechasDePagosMulti([{ referencia_epayco: '', valor_pago: '' }], [cobro('', 0, '2026-09-01')])).toEqual([null])
  })
})
