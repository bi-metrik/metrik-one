import { afterEach, describe, expect, it } from 'vitest'
import { TECHO_EDAD_MS } from './decidir'
import {
  anotarEpocaViva,
  epocaVivaConocida,
  motivoActual,
  olvidarPestana,
  registrarPestana,
  tocaCargaCompleta,
} from './recarga-pendiente'

const NACIO = 1_000_000

afterEach(() => olvidarPestana())

describe('recarga pendiente de la pestaña', () => {
  it('sin vigilante (fuera del shell de la app), nunca toca carga completa', () => {
    expect(motivoActual(NACIO + TECHO_EDAD_MS * 10)).toBeNull()
    expect(tocaCargaCompleta(NACIO + TECHO_EDAD_MS * 10, true)).toBe(false)
  })

  it('pestaña joven sin epoca nueva: navega suave', () => {
    registrarPestana(1, NACIO)
    anotarEpocaViva(1)
    expect(tocaCargaCompleta(NACIO + 1000, true)).toBe(false)
  })

  it('pasado el techo, la siguiente navegacion carga completo', () => {
    registrarPestana(1, NACIO)
    expect(tocaCargaCompleta(NACIO + TECHO_EDAD_MS - 1, true)).toBe(false)
    expect(tocaCargaCompleta(NACIO + TECHO_EDAD_MS, true)).toBe(true)
    expect(motivoActual(NACIO + TECHO_EDAD_MS)).toBe('techo')
  })

  it('una epoca viva mayor deja la carga completa pendiente', () => {
    registrarPestana(1, NACIO)
    anotarEpocaViva(2)
    expect(motivoActual(NACIO + 1000)).toBe('epoca')
    expect(tocaCargaCompleta(NACIO + 1000, true)).toBe(true)
  })

  // Un fallo de /api/version no borra lo que ya se supo: si la epoca nueva ya se vio, sigue
  // pendiente aunque la siguiente consulta falle.
  it('una consulta fallida (null) no borra la epoca ya conocida', () => {
    registrarPestana(1, NACIO)
    anotarEpocaViva(2)
    anotarEpocaViva(null)
    expect(epocaVivaConocida()).toBe(2)
  })

  it('sin red, nunca carga completo', () => {
    registrarPestana(1, NACIO)
    anotarEpocaViva(5)
    expect(tocaCargaCompleta(NACIO + TECHO_EDAD_MS, false)).toBe(false)
  })

  // Lo que evita el bucle: la pagina nueva se registra de cero, con su epoca y su edad.
  it('al registrarse de nuevo (pagina recien cargada) arranca limpia', () => {
    registrarPestana(1, NACIO)
    anotarEpocaViva(2)
    registrarPestana(2, NACIO + TECHO_EDAD_MS)
    expect(epocaVivaConocida()).toBeNull()
    expect(tocaCargaCompleta(NACIO + TECHO_EDAD_MS + 1000, true)).toBe(false)
  })
})
