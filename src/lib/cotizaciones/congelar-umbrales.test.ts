import { describe, it, expect } from 'vitest'
import { faltaLaColumnaDeUmbrales, sinUmbralesCongelados, insertarCotizacionTolerante } from './congelar-umbrales'

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

/**
 * Doble de PostgREST que acepta o rechaza segun las columnas que la "base" tenga.
 *
 * ⚠️ Sin esta prueba el reintento quedaba sin ejercitar: los dos helpers puros de
 * arriba pueden estar perfectos y el cableado seguir insertando dos veces con el
 * mismo payload. Lo que rompe en produccion es el cableado, no los helpers.
 */
function baseConColumnas(columnas: string[]) {
  const intentos: Record<string, unknown>[] = []
  const cliente = {
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        intentos.push(payload)
        const sobra = Object.keys(payload).find((k) => !columnas.includes(k))
        const resultado = sobra
          ? { data: null, error: { code: '42703', message: `column "${sobra}" of relation "cotizaciones" does not exist` } }
          : { data: { id: 'cot-nueva' }, error: null }
        return { select: () => ({ single: async () => resultado }) }
      },
    }),
  }
  return { cliente, intentos }
}

const PAYLOAD = {
  workspace_id: 'w1',
  convencion_margen: 'sobre_venta',
  piso_margen_pct: 5,
  aviso_margen_pct: 10,
}
const CON_UMBRALES = ['workspace_id', 'convencion_margen', 'piso_margen_pct', 'aviso_margen_pct']
const SIN_UMBRALES = ['workspace_id', 'convencion_margen']

describe('insertarCotizacionTolerante', () => {
  it('con la migración aplicada congela y NO reintenta', async () => {
    const { cliente, intentos } = baseConColumnas(CON_UMBRALES)
    const r = await insertarCotizacionTolerante(cliente, PAYLOAD)
    expect(r.data).toEqual({ id: 'cot-nueva' })
    expect(intentos).toHaveLength(1)
    expect(intentos[0].piso_margen_pct).toBe(5)
  })

  it('sin la migración la cotización SE CREA igual, sin congelar', async () => {
    // Lo que no puede pasar: que crear o duplicar una cotización deje de funcionar
    // porque la migración no está aplicada.
    const { cliente, intentos } = baseConColumnas(SIN_UMBRALES)
    const r = await insertarCotizacionTolerante(cliente, PAYLOAD)
    expect(r.error).toBeNull()
    expect(r.data).toEqual({ id: 'cot-nueva' })
    expect(intentos).toHaveLength(2)
    expect(intentos[1]).not.toHaveProperty('piso_margen_pct')
    // Lo demás de la política SÍ viaja en el reintento: se cae la congelación de
    // los umbrales, no la convención.
    expect(intentos[1].convencion_margen).toBe('sobre_venta')
  })

  it('un error que NO es de las columnas se propaga sin reintentar', async () => {
    const cliente = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }),
          }),
        }),
      }),
    }
    const r = await insertarCotizacionTolerante(cliente, PAYLOAD)
    expect(r.error?.code).toBe('23505')
  })
})
