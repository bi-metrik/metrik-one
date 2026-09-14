/**
 * R-P1 · un rubro sugerido NO entra al costo.
 *
 * La invariante que sostiene persistir la propuesta del pantallazo: se puede guardar
 * porque nadie la suma. El día que un lector se salte este filtro, el costo sube sin
 * que nadie lo haya confirmado — y eso no falla en ninguna parte, se ve como un margen
 * peor, que es la clase de defecto que más tarda en encontrarse.
 */

import { describe, it, expect } from 'vitest'

import {
  costoDeRubrosConfirmados,
  esConfirmado,
  soloConfirmados,
  soloSugeridos,
} from './rubros-sugeridos'
import { calcularCascada } from './totales'

describe('R-P1 · el sugerido no cuenta', () => {
  it('cuenta lo confirmado y descarta lo sugerido', () => {
    const rubros = [
      { valor_total: 1_000_000, sugerido: false },
      { valor_total: 500_000, sugerido: true },
      { valor_total: 200_000, sugerido: false },
    ]
    expect(costoDeRubrosConfirmados(rubros)).toEqual({
      numeroDeRubros: 2,
      costoDeRubros: 1_200_000,
    })
  })

  it('⚠️ `sugerido` ausente cuenta como CONFIRMADO', () => {
    // Es lo que llega de cualquier consulta que no pida la columna, y lo que llegaba
    // antes de la migración. Tratarlo como sugerido dejaría el costo de TODA cotización
    // en cero — un fallo mudo, porque un margen del 100% se ve como una buena noticia.
    expect(esConfirmado({})).toBe(true)
    expect(esConfirmado({ sugerido: null })).toBe(true)
    expect(esConfirmado({ sugerido: false })).toBe(true)
    expect(esConfirmado({ sugerido: true })).toBe(false)

    expect(costoDeRubrosConfirmados([{ valor_total: 900 }])).toEqual({
      numeroDeRubros: 1,
      costoDeRubros: 900,
    })
  })

  it('`numeroDeRubros` también sale filtrado, y no es un detalle', () => {
    // `costoUnitarioDelItem` decide con ese número si el costo del ítem viene del
    // desglose o del `subtotal` escrito a mano. Un ítem con SOLO sugeridos tiene que
    // seguir costando lo que diga su subtotal: contarlos lo dejaría en cero.
    const soloSugerido = [{ valor_total: 700_000, sugerido: true }]
    expect(costoDeRubrosConfirmados(soloSugerido)).toEqual({
      numeroDeRubros: 0,
      costoDeRubros: 0,
    })

    const item = {
      id: 'i1',
      cantidad: 1,
      subtotal: 300_000,
      ...costoDeRubrosConfirmados(soloSugerido),
    }
    const cascada = calcularCascada([item], { margenPct: 0, convencionMargen: 'markup' as const })
    expect(cascada.costoDirecto).toBe(300_000)
  })

  it('una propuesta guardada NO mueve el costo ni el margen', () => {
    // La comprobación que autoriza la columna: la misma cotización, con y sin la
    // propuesta encima, tiene que dar exactamente las mismas cifras.
    const params = { margenPct: 13, convencionMargen: 'sobre_venta' as const }
    const sinPropuesta = [{ valor_total: 2_000_000, sugerido: false }]
    const conPropuesta = [...sinPropuesta, { valor_total: 1_825_000, sugerido: true }]

    const linea = (rubros: typeof conPropuesta) => ({
      id: 'vuelo',
      cantidad: 1,
      subtotal: 0,
      ...costoDeRubrosConfirmados(rubros),
    })

    const antes = calcularCascada([linea(sinPropuesta)], params)
    const despues = calcularCascada([linea(conPropuesta)], params)

    expect(despues.costoDirecto).toBe(antes.costoDirecto)
    expect(despues.precioVenta).toBe(antes.precioVenta)
    expect(despues.margenRealPct).toBe(antes.margenRealPct)

    // El control que hace válida la comprobación de arriba: si el rubro extra ENTRARA,
    // las cifras sí se moverían. Sin esto, una cascada que ignorara el segundo rubro
    // por cualquier otra razón pasaría igual.
    const siEntrara = calcularCascada(
      [{ id: 'vuelo', cantidad: 1, subtotal: 0, numeroDeRubros: 2, costoDeRubros: 3_825_000 }],
      params,
    )
    expect(siEntrara.costoDirecto).not.toBe(antes.costoDirecto)
  })

  it('separa las dos listas sin perder ninguna fila', () => {
    const rubros = [
      { id: 'a', sugerido: false },
      { id: 'b', sugerido: true },
      { id: 'c' },
    ]
    expect(soloConfirmados(rubros).map(r => r.id)).toEqual(['a', 'c'])
    expect(soloSugeridos(rubros).map(r => r.id)).toEqual(['b'])
    expect(soloConfirmados(rubros).length + soloSugeridos(rubros).length).toBe(rubros.length)
  })

  it('un valor no numérico no rompe la suma', () => {
    // `valor_total` llega de PostgREST como numeric: puede venir null en una fila a
    // medio escribir. Un NaN aquí se propagaría al total de la cotización.
    expect(costoDeRubrosConfirmados([{ valor_total: null }, { valor_total: 100 }]).costoDeRubros).toBe(100)
    expect(costoDeRubrosConfirmados(null).costoDeRubros).toBe(0)
    expect(costoDeRubrosConfirmados(undefined).numeroDeRubros).toBe(0)
  })
})
