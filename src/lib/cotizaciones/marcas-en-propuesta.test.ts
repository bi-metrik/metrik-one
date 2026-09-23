/**
 * «Va en propuesta» mientras el servidor contesta: el clic del medio no se pierde.
 *
 * El escenario es el del ensayo del 2026-09-23 (COT-2026-0009): las tres tarifas marcadas
 * seguidas, con la segunda llegando cuando la primera todavía no había vuelto.
 */
import { describe, expect, it } from 'vitest'

import {
  anotarClic,
  anotarRespuesta,
  conciliarConServidor,
  marcaEnCamino,
  marcaVisible,
  type MarcasPendientes,
} from './marcas-en-propuesta'

/** Lo que devuelve el servidor, en la forma de `ItinerarioCalculado` que importa aquí. */
const servidor = (eco: boolean, rec: boolean, pre: boolean) => [
  { id: 'eco', vaEnPropuesta: eco },
  { id: 'rec', vaEnPropuesta: rec },
  { id: 'pre', vaEnPropuesta: pre },
]

describe('tres clics seguidos: los tres se ven y los tres se guardan', () => {
  it('cada clic se ve marcado antes de que el servidor conteste', () => {
    let m: MarcasPendientes = {}
    m = anotarClic(m, 'eco', true)
    m = anotarClic(m, 'rec', true) // llega con la primera todavía en camino
    m = anotarClic(m, 'pre', true)
    expect(['eco', 'rec', 'pre'].map(id => marcaVisible(id, false, m))).toEqual([true, true, true])
    expect(['eco', 'rec', 'pre'].map(id => marcaEnCamino(id, m))).toEqual([true, true, true])
  })

  it('un refresco intermedio con el dato viejo no borra lo que sigue en camino', () => {
    let m: MarcasPendientes = {}
    m = anotarClic(m, 'eco', true)
    m = anotarClic(m, 'rec', true)
    m = anotarRespuesta(m, 'eco', true, true)
    // Llega el refresco de la primera: la Económica ya está, la Recomendada todavía no.
    m = conciliarConServidor(m, servidor(true, false, false))
    expect(marcaVisible('eco', true, m)).toBe(true)
    expect(marcaVisible('rec', false, m)).toBe(true)
    expect(marcaEnCamino('rec', m)).toBe(true)
  })

  it('cuando el servidor ya lo tiene todo, no queda ninguna anotación', () => {
    let m: MarcasPendientes = {}
    for (const id of ['eco', 'rec', 'pre']) m = anotarClic(m, id, true)
    for (const id of ['eco', 'rec', 'pre']) m = anotarRespuesta(m, id, true, true)
    m = conciliarConServidor(m, servidor(true, true, true))
    expect(m).toEqual({})
  })
})

describe('el servidor manda en cuanto contesta', () => {
  it('si la llamada falla, la casilla vuelve a lo que dice el servidor', () => {
    let m = anotarClic({}, 'rec', true)
    m = anotarRespuesta(m, 'rec', true, false)
    expect(marcaVisible('rec', false, m)).toBe(false)
    expect(marcaEnCamino('rec', m)).toBe(false)
  })

  it('confirmada, se retira con el siguiente dato del servidor aunque diga otra cosa', () => {
    // Otra edición la desmarcó entre medio (quedó bajo el piso): la anotación no puede
    // sostener un «marcada» que la base ya no tiene.
    let m = anotarClic({}, 'rec', true)
    m = anotarRespuesta(m, 'rec', true, true)
    expect(marcaVisible('rec', false, m)).toBe(true)
    m = conciliarConServidor(m, servidor(false, false, false))
    expect(marcaVisible('rec', false, m)).toBe(false)
  })

  it('sin confirmar, un dato del servidor que todavía no la tiene no la retira', () => {
    let m = anotarClic({}, 'rec', true)
    m = conciliarConServidor(m, servidor(false, false, false))
    expect(marcaVisible('rec', false, m)).toBe(true)
  })

  it('una tarifa borrada pierde su anotación', () => {
    let m = anotarClic({}, 'rec', true)
    m = conciliarConServidor(m, [{ id: 'eco', vaEnPropuesta: false }])
    expect(m).toEqual({})
  })
})

describe('marcar y desmarcar la misma casilla seguido', () => {
  it('la respuesta del primer clic no pisa lo que pidió el segundo', () => {
    let m = anotarClic({}, 'rec', true)
    m = anotarClic(m, 'rec', false)
    m = anotarRespuesta(m, 'rec', true, true) // contesta el primero
    expect(marcaVisible('rec', true, m)).toBe(false)
    expect(marcaEnCamino('rec', m)).toBe(true)
    m = anotarRespuesta(m, 'rec', false, true) // contesta el segundo
    m = conciliarConServidor(m, servidor(false, false, false))
    expect(m).toEqual({})
  })

  it('un fallo del primero tampoco borra el segundo', () => {
    let m = anotarClic({}, 'rec', true)
    m = anotarClic(m, 'rec', false)
    m = anotarRespuesta(m, 'rec', true, false)
    expect(marcaEnCamino('rec', m)).toBe(true)
    expect(marcaVisible('rec', true, m)).toBe(false)
  })
})

it('sin cambios devuelve el mismo objeto: la pantalla no vuelve a pintar por nada', () => {
  const m = anotarClic({}, 'rec', true)
  expect(conciliarConServidor(m, servidor(false, false, false))).toBe(m)
})
