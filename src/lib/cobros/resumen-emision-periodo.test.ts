import { describe, it, expect } from 'vitest'
import {
  offsetCorrelativoExplicitas,
  resumirEmisionPeriodo,
  type ConteosExplicitas,
  type ConteosUniformes,
  type DetalleUniformeMin,
} from './resumen-emision-periodo'

describe('offsetCorrelativoExplicitas', () => {
  const detalles: DetalleUniformeMin[] = [
    { estado: 'creada' },
    { estado: 'omitida' },
    { estado: 'creada' },
    { estado: 'error' },
  ]

  it('en emision real siempre es 0: cada insert corre el MAX de verdad', () => {
    expect(offsetCorrelativoExplicitas(detalles, false)).toBe(0)
  })

  it('en dry-run desplaza tantas posiciones como cuentas uniformes se crearian', () => {
    // Sin esto, la primera cuota explicita reusaria el numero de la primera
    // uniforme: el preview no inserta, asi que el MAX+1 de la base no se movio.
    expect(offsetCorrelativoExplicitas(detalles, true)).toBe(2)
  })

  it('no cuenta las omitidas: reusan el numero que ya tienen', () => {
    expect(offsetCorrelativoExplicitas([{ estado: 'omitida' }, { estado: 'omitida' }], true)).toBe(0)
  })

  it('no cuenta los errores: no llegan a pedir numero', () => {
    expect(offsetCorrelativoExplicitas([{ estado: 'error' }], true)).toBe(0)
  })

  it('sin detalles uniformes no hay nada que desplazar', () => {
    expect(offsetCorrelativoExplicitas([], true)).toBe(0)
  })
})

describe('resumirEmisionPeriodo', () => {
  const uniformes: ConteosUniformes = {
    cuentasCreadas: 3,
    cuentasOmitidas: 1,
    errores: [{ empresa_id: 'emp-1', error: 'Empresa sin email fiscal' }],
  }
  const explicitas: ConteosExplicitas = {
    cuentasCreadas: 1,
    cuentasOmitidas: 2,
    errores: [{ plan_cuota_id: 'cuota-9', error: 'Negocio sin empresa asociada' }],
  }

  it('suma los dos caminos en el conteo unico que lee la pantalla', () => {
    const r = resumirEmisionPeriodo(uniformes, explicitas)
    expect(r.cuentasCreadas).toBe(4)
    expect(r.cuentasOmitidas).toBe(3)
  })

  it('conserva de que camino viene cada error y con que id se ubica', () => {
    // "empresa X" y "cuota Y" no se diagnostican en el mismo sitio: mezclarlos
    // sin decirlo manda a buscar al lugar equivocado.
    expect(resumirEmisionPeriodo(uniformes, explicitas).errores).toEqual([
      { origen: 'uniforme', ref: 'emp-1', error: 'Empresa sin email fiscal' },
      { origen: 'explicita', ref: 'cuota-9', error: 'Negocio sin empresa asociada' },
    ])
  })

  it('un periodo limpio resume en ceros y sin errores', () => {
    const vacio = { cuentasCreadas: 0, cuentasOmitidas: 0, errores: [] }
    expect(resumirEmisionPeriodo(vacio, vacio)).toEqual({
      cuentasCreadas: 0,
      cuentasOmitidas: 0,
      errores: [],
    })
  })

  it('un camino sin resultados no borra lo del otro', () => {
    // El caso real de agosto 2026: nada uniforme que emitir y una cuota
    // explicita vencida. Si el resumen colgara del primer camino, el boton
    // diria "nada que emitir" con la cuota de Trappvel sin facturar.
    const r = resumirEmisionPeriodo(
      { cuentasCreadas: 0, cuentasOmitidas: 0, errores: [] },
      { cuentasCreadas: 1, cuentasOmitidas: 0, errores: [] },
    )
    expect(r).toEqual({ cuentasCreadas: 1, cuentasOmitidas: 0, errores: [] })
  })

  it('no muta los conteos que recibe', () => {
    resumirEmisionPeriodo(uniformes, explicitas)
    expect(uniformes.errores).toHaveLength(1)
    expect(explicitas.errores).toHaveLength(1)
  })
})
