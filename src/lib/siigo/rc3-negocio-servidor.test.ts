/**
 * La lectura de la base que alimenta el plan del RC-3 (SOE-029).
 *
 * Lo que se fija aquí es lo que una prueba pura no ve: de QUÉ tabla sale cada dato, que el
 * comprobante se busca por el slug de su bloque, que un pago anulado no cuenta, y que una
 * lectura fallida no se convierte en un plan con datos a medias.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { cargarPlanRc3, valorRc3DelCobro } from './rc3-negocio-servidor'

type Fila = Record<string, unknown>
let tablas: Record<string, Fila[]>
let fallaTabla: string | null
let filtrosVistos: Array<[string, string, unknown]>

function svcFalso() {
  return {
    from: (tabla: string) => {
      const filtros: Array<[string, unknown]> = []
      const chain = {
        select: () => chain,
        eq: (c: string, v: unknown) => { filtros.push([c, v]); filtrosVistos.push([tabla, c, v]); return chain },
        maybeSingle: async () => ({ data: filas()[0] ?? null, error: fallaTabla === tabla ? { message: 'boom' } : null }),
        then: (r: (v: unknown) => unknown) =>
          r({ data: filas(), error: fallaTabla === tabla ? { message: 'boom' } : null }),
      }
      const filas = () => (tablas[tabla] ?? []).filter(f => filtros.every(([c, v]) => f[c] === undefined || f[c] === v))
      return chain
    },
  }
}

beforeEach(() => {
  fallaTabla = null
  filtrosVistos = []
  tablas = {
    cobros: [
      { id: 'a', fecha: '2026-09-10', monto: 450_045, tipo_cobro: 'anticipo', siigo_recibo: null, anulado_at: null, recibo_no_aplica: null },
      // Anulado: no documenta plata recibida, no puede ser titular.
      { id: 'x', fecha: '2026-09-15', monto: 701_767, tipo_cobro: 'pago', siigo_recibo: null, anulado_at: '2026-09-16', recibo_no_aplica: null },
      { id: 'b', fecha: '2026-09-20', monto: 701_767, tipo_cobro: 'pago', siigo_recibo: null, anulado_at: null, recibo_no_aplica: null },
    ],
    v_cobro_valor: [
      { cobro_id: 'a', a_tramo1: 450_000, a_tramo2: 0, a_tarifa: 45, excedente: 0 },
      { cobro_id: 'x', a_tramo1: 0, a_tramo2: 0, a_tarifa: 701_767, excedente: 0 },
      { cobro_id: 'b', a_tramo1: 0, a_tramo2: 0, a_tarifa: 701_767, excedente: 0 },
    ],
    v_negocio_valor: [{ techo_tarifa: '701812' }],
    negocio_bloques: [{ data: { campos: { valor_pagado: { value: '701.812' } } } }],
  }
})

describe('cargarPlanRc3', () => {
  it('arma el plan con el comprobante, el techo y los pagos vivos', async () => {
    const plan = await cargarPlanRc3(svcFalso(), 'ws', 'neg-1')

    expect(plan.estado).toBe('emitir')
    expect(plan.comprobante).toBe(701_812)
    expect(plan.titularId).toBe('b')
    expect(plan.valor).toBe(701_812)
    expect(plan.roles.has('x')).toBe(false)
  })

  it('busca el comprobante por el slug de su bloque, y los cobros dentro del workspace', async () => {
    await cargarPlanRc3(svcFalso(), 'ws', 'neg-1')

    expect(filtrosVistos).toContainEqual(['negocio_bloques', 'bloque_configs.slug', 'comprobante_pago_upme'])
    expect(filtrosVistos).toContainEqual(['cobros', 'workspace_id', 'ws'])
  })

  it('una lectura que falla LANZA: no se decide un valor con datos a medias', async () => {
    fallaTabla = 'negocio_bloques'
    await expect(cargarPlanRc3(svcFalso(), 'ws', 'neg-1')).rejects.toThrow('negocio_bloques')
  })
})

describe('valorRc3DelCobro', () => {
  it('el titular recibe el valor del comprobante', async () => {
    expect(await valorRc3DelCobro(svcFalso(), 'ws', 'neg-1', 'b')).toEqual({ ok: true, valor: 701_812 })
  })

  it('sin comprobante, bloquea con el mensaje y no da valor', async () => {
    tablas.negocio_bloques = []
    expect(await valorRc3DelCobro(svcFalso(), 'ws', 'neg-1', 'b')).toEqual({
      ok: false,
      mensaje: 'Falta el valor del comprobante de pago UPME: revisa el bloque del comprobante en el negocio.',
      bloqueo: true,
    })
  })

  it('una lectura fallida es un bloqueo, no un valor', async () => {
    fallaTabla = 'cobros'
    const r = await valorRc3DelCobro(svcFalso(), 'ws', 'neg-1', 'b')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.bloqueo).toBe(true)
  })
})
