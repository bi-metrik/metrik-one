import { describe, expect, it } from 'vitest'
import { filasConId, planearGuardadoMulti, type CobroExistente, type FilaMultiPago } from './multi-pago-filas'
import { puedeEditarMultiPago } from '@/lib/permissions/multi-pago'

const fila = (id: string, ref: string, valor: number | '', cobro_id: string | null = null): FilaMultiPago =>
  ({ id, referencia_epayco: ref, valor_pago: valor, cobro_id })
const cobro = (id: string, ref: string, monto: number, bloqueado = false): CobroExistente =>
  ({ id, external_ref: ref, monto, bloqueado })

describe('guardar las filas del bloque multi-pago', () => {
  it('una fila nueva crea su cobro', () => {
    const p = planearGuardadoMulti([fila('f1', '344799998', 1_500_000)], [], [])
    expect(p.crear).toEqual([{ filaId: 'f1', referencia: '344799998', monto: 1_500_000 }])
    expect(p.errores).toEqual([])
  })

  it('editar el valor corrige SU cobro: no crea otro', () => {
    const previas = [fila('f1', '344799998', 150, 'c1')]
    const p = planearGuardadoMulti([fila('f1', '344799998', 1_500_000, 'c1')], previas, [cobro('c1', '344799998', 150)])
    expect(p.crear).toEqual([])
    expect(p.corregir).toEqual([{ cobroId: 'c1', referencia: '344799998', monto: 1_500_000 }])
    expect(p.anular).toEqual([])
  })

  it('quitar una fila anula su cobro', () => {
    const previas = [fila('f1', 'A', 100, 'c1'), fila('f2', 'B', 200, 'c2')]
    const p = planearGuardadoMulti([fila('f1', 'A', 100, 'c1')], previas, [cobro('c1', 'A', 100), cobro('c2', 'B', 200)])
    expect(p.anular).toEqual([{ cobroId: 'c2', referencia: 'B', montoAnterior: 200 }])
    expect(p.crear).toEqual([])
    expect(p.corregir).toEqual([])
  })

  it('una fila confirmada por la financiera no se edita ni se quita', () => {
    const previas = [fila('f1', 'A', 100, 'c1')]
    const existentes = [cobro('c1', 'A', 100, true)]
    expect(planearGuardadoMulti([fila('f1', 'A', 999, 'c1')], previas, existentes).errores[0]).toMatch(/ya lo confirmó/)
    expect(planearGuardadoMulti([], previas, existentes).errores[0]).toMatch(/no se puede quitar/)
    // Sin cambios, guardar no la toca.
    expect(planearGuardadoMulti([fila('f1', 'A', 100, 'c1')], previas, existentes)).toMatchObject({ errores: [], corregir: [], anular: [] })
  })

  it('re-guardar lo mismo no hace nada', () => {
    const f = [fila('f1', 'A', 100, 'c1')]
    const p = planearGuardadoMulti(f, f, [cobro('c1', 'A', 100)])
    expect(p).toMatchObject({ crear: [], corregir: [], anular: [], errores: [] })
  })

  it('dos pagos reales con la misma referencia y monto son dos cobros (bug 26)', () => {
    const p = planearGuardadoMulti([fila('f1', 'A', 100), fila('f2', 'A', 100)], [], [cobro('c1', 'A', 100)])
    expect(p.crear).toHaveLength(1)
    expect(p.filas.map((x) => x.cobro_id)).toEqual(['c1', null])
  })

  it('filas guardadas antes del cambio (sin id ni cobro) se atan a su cobro, no se duplican', () => {
    const previas = filasConId([{ referencia_epayco: 'A', valor_pago: 100 }], () => 'viejo-1')
    // La pantalla les puso otro id al cargarlas: igual se reconocen por referencia y monto.
    const p = planearGuardadoMulti([fila('pantalla-1', 'A', 100)], previas, [cobro('c1', 'A', 100)])
    expect(p).toMatchObject({ crear: [], corregir: [], anular: [], errores: [] })
    expect(p.filas[0].cobro_id).toBe('c1')
  })

  it('valida antes de escribir: referencia y valor', () => {
    const p = planearGuardadoMulti([fila('f1', '', 0)], [], [])
    expect(p.errores).toEqual(['Fila 1: falta la referencia', 'Fila 1: el valor tiene que ser mayor a cero'])
  })
})

describe('permiso del bloque: una sola regla para pantalla y servidor', () => {
  it('owner y admin editan; el resto lo ve', () => {
    expect(['owner', 'admin'].map(puedeEditarMultiPago)).toEqual([true, true])
    expect(['supervisor', 'operator', 'contador', 'read_only', null].map(puedeEditarMultiPago)).toEqual([false, false, false, false, false])
  })
})
