import { describe, it, expect } from 'vitest'
import { faltaLaColumnaDeUmbrales, sinUmbralesCongelados } from './congelar-umbrales'

describe('faltaLaColumnaDeUmbrales', () => {
  it('reconoce el 42703 de las columnas de umbral', () => {
    expect(faltaLaColumnaDeUmbrales({
      code: '42703',
      message: `column "piso_margen_pct" of relation "cotizaciones" does not exist`,
    })).toBe(true)
    expect(faltaLaColumnaDeUmbrales({
      code: '42703',
      message: `column "aviso_margen_pct" of relation "cotizaciones" does not exist`,
    })).toBe(true)
  })

  it('NO se traga un 42703 de otra columna', () => {
    // Ese es un error real del código y tiene que propagarse. Reintentar sin los
    // umbrales lo convertiría en un fallo mudo con otro nombre.
    expect(faltaLaColumnaDeUmbrales({
      code: '42703',
      message: `column "convencion_margen" of relation "cotizaciones" does not exist`,
    })).toBe(false)
  })

  it('NO se traga otros errores que mencionen la columna', () => {
    expect(faltaLaColumnaDeUmbrales({
      code: '23514',
      message: `new row violates check constraint on piso_margen_pct`,
    })).toBe(false)
  })

  it('sin error no hay nada que reintentar', () => {
    expect(faltaLaColumnaDeUmbrales(null)).toBe(false)
    expect(faltaLaColumnaDeUmbrales(undefined)).toBe(false)
    expect(faltaLaColumnaDeUmbrales({})).toBe(false)
  })
})

describe('sinUmbralesCongelados', () => {
  it('quita SOLO las dos columnas de umbral', () => {
    const payload = {
      workspace_id: 'w1',
      convencion_margen: 'sobre_venta',
      margen_default_pct: 15,
      piso_margen_pct: 5,
      aviso_margen_pct: 10,
    }
    expect(sinUmbralesCongelados(payload)).toEqual({
      workspace_id: 'w1',
      convencion_margen: 'sobre_venta',
      margen_default_pct: 15,
    })
  })

  it('no muta el original: el primer intento ya lo usó', () => {
    const payload = { a: 1, piso_margen_pct: 5, aviso_margen_pct: 10 }
    sinUmbralesCongelados(payload)
    expect(payload.piso_margen_pct).toBe(5)
  })

  it('un payload que no las trae pasa igual', () => {
    expect(sinUmbralesCongelados({ a: 1 })).toEqual({ a: 1 })
  })
})
