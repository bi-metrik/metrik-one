/**
 * El barrido, con la red y la base mockeadas. Lo que se prueba es lo que decide si el universo
 * guardado es completo o parcial, y qué pasa cuando algo falla a mitad de camino.
 */
import { describe, expect, it, vi } from 'vitest'
import { LOTE_UPSERT, TOPE_PAGINAS, barrer, lotes, sincronizarRadar } from './sync'
import type { FilaSocrata, ProcesoRadar } from './socrata'

const fila = (n: number): FilaSocrata => ({
  id_del_proceso: `CO1.NTC.${n}`,
  referencia_del_proceso: `REF-${n}`,
  descripci_n_del_procedimiento: 'FABRICA DE SOFTWARE',
  modalidad_de_contratacion: 'Mínima cuantía',
  tipo_de_contrato: 'Suministro',
  fecha_de_recepcion_de: '2026-10-06T00:00:00.000',
})

const filas = (desde: number, cuantas: number) => Array.from({ length: cuantas }, (_, i) => fila(desde + i))

/** Un upsert que recuerda lo que le llegó. */
function espiaUpsert() {
  const escritas: ProcesoRadar[] = []
  return {
    escritas,
    upsert: async (f: readonly ProcesoRadar[]) => {
      escritas.push(...f)
      return null
    },
  }
}

describe('paginación', () => {
  it('una página incompleta cierra el barrido: es la única señal de «se acabó»', async () => {
    const traer = vi.fn(async () => filas(1, 2075))
    const r = await barrer('2026-09-28', traer)
    expect(r.paginas).toBe(1)
    expect(r.filas).toHaveLength(2075)
    expect(r.truncado).toBe(false)
    expect(traer).toHaveBeenCalledTimes(1)
  })

  it('una página COMPLETA obliga a pedir la siguiente, y el offset avanza', async () => {
    // El `$limit` de Socrata corta en silencio: 20.000 filas exactas pueden ser el final o un corte.
    const urls: string[] = []
    const traer = vi.fn(async (url: string) => {
      urls.push(url)
      return urls.length === 1 ? filas(1, 20000) : filas(20001, 5)
    })
    const r = await barrer('2026-09-28', traer)
    expect(r.paginas).toBe(2)
    expect(r.filas).toHaveLength(20005)
    expect(new URL(urls[0]).searchParams.get('$offset')).toBe('0')
    expect(new URL(urls[1]).searchParams.get('$offset')).toBe('20000')
  })

  it('el tope de páginas corta y lo DICE: un universo parcial no se guarda como si fuera todo', async () => {
    const traer = vi.fn(async () => filas(1, 20000))
    const r = await barrer('2026-09-28', traer)
    expect(r.paginas).toBe(TOPE_PAGINAS)
    expect(r.truncado).toBe(true)
  })
})

describe('lotes', () => {
  it('parte en tamaños de LOTE_UPSERT y el último es el resto', () => {
    const xs = Array.from({ length: LOTE_UPSERT * 2 + 3 }, (_, i) => i)
    const l = lotes(xs)
    expect(l).toHaveLength(3)
    expect(l[0]).toHaveLength(LOTE_UPSERT)
    expect(l[2]).toHaveLength(3)
    // Ni una fila se pierde ni se repite.
    expect(l.flat()).toEqual(xs)
  })

  it('una lista vacía no produce lotes (no se llama a la base por nada)', () => {
    expect(lotes([])).toEqual([])
  })
})

describe('el barrido completo', () => {
  it('deduplica antes de escribir y reporta las dos cifras', async () => {
    const espia = espiaUpsert()
    // 3 filas del MISMO proceso (las fases) + 2 procesos distintos = 3 únicos.
    const crudas = [fila(1), fila(1), fila(1), fila(2), fila(3)]
    const r = await sincronizarRadar('2026-09-28', { traerPagina: async () => crudas, upsert: espia.upsert })
    expect(r.ok).toBe(true)
    expect(r.filasCrudas).toBe(5)
    expect(r.procesosUnicos).toBe(3)
    expect(r.escritos).toBe(3)
    expect(espia.escritas.map((x) => x.notice_uid)).toEqual(['CO1.NTC.1', 'CO1.NTC.2', 'CO1.NTC.3'])
  })

  it('las banderas derivadas llegan ya calculadas a la base', async () => {
    const espia = espiaUpsert()
    await sincronizarRadar('2026-09-28', { traerPagina: async () => [fila(1)], upsert: espia.upsert })
    // Mínima cuantía no exige RUP; Suministro es compra de bienes. Las dos salen de la biblioteca.
    expect(espia.escritas[0].sin_rup).toBe(true)
    expect(espia.escritas[0].es_compra).toBe(true)
  })

  it('un lote que falla no tumba los demás, y el resumen deja de estar ok', async () => {
    let n = 0
    const r = await sincronizarRadar('2026-09-28', {
      traerPagina: async () => filas(1, LOTE_UPSERT + 10),
      upsert: async () => {
        n++
        return n === 1 ? 'timeout' : null
      },
    })
    expect(r.ok).toBe(false)
    expect(r.procesosUnicos).toBe(LOTE_UPSERT + 10)
    // El segundo lote sí entró: medio universo actualizado es mejor que ninguno.
    expect(r.escritos).toBe(10)
    expect(r.errores).toEqual([`lote de ${LOTE_UPSERT}: timeout`])
  })

  it('si la red falla no se escribe nada y el error viaja al resumen', async () => {
    const espia = espiaUpsert()
    const r = await sincronizarRadar('2026-09-28', {
      traerPagina: async () => {
        throw new Error('socrata 503')
      },
      upsert: espia.upsert,
    })
    expect(r.ok).toBe(false)
    expect(r.errores).toEqual(['socrata 503'])
    expect(r.escritos).toBe(0)
    // Lo importante: un fallo de red NO vacía la tabla. El upsert no se llamó ni una vez.
    expect(espia.escritas).toEqual([])
  })

  it('el truncado queda escrito en los errores, aunque todos los lotes hayan entrado', async () => {
    const espia = espiaUpsert()
    const r = await sincronizarRadar('2026-09-28', {
      traerPagina: async () => filas(1, 20000),
      upsert: espia.upsert,
    })
    expect(r.truncado).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.errores[0]).toContain('universo guardado es PARCIAL')
  })

  it('un día sin convocatorias no es un error', async () => {
    const espia = espiaUpsert()
    const r = await sincronizarRadar('2026-09-28', { traerPagina: async () => [], upsert: espia.upsert })
    expect(r.ok).toBe(true)
    expect(r.procesosUnicos).toBe(0)
    expect(espia.escritas).toEqual([])
  })
})
