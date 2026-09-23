import { describe, it, expect } from 'vitest'
import { escaparLike, filtroBusquedaNegocio, valorEntreComillas } from './busqueda-negocio'

describe('filtroBusquedaNegocio', () => {
  it('un código normal busca en código y nombre, entre comillas', () => {
    expect(filtroBusquedaNegocio('  v0477 ')).toBe('codigo.ilike."%v0477%",nombre.ilike."%v0477%"')
  })

  it('con menos de dos letras no busca', () => {
    expect(filtroBusquedaNegocio('')).toBeNull()
    expect(filtroBusquedaNegocio(' v ')).toBeNull()
  })

  it('la coma y los paréntesis quedan dentro de las comillas: no parten el filtro', () => {
    const f = filtroBusquedaNegocio('Pérez, Juan (hijo)')!
    // Exactamente dos condiciones: la coma del nombre no crea una tercera.
    expect(f).toBe('codigo.ilike."%Pérez, Juan (hijo)%",nombre.ilike."%Pérez, Juan (hijo)%"')
  })

  it('% y _ se buscan literales, no como comodines', () => {
    expect(escaparLike('10%_a')).toBe('10\\%\\_a')
    // LIKE: 10\% ; dentro de comillas de PostgREST la barra se duplica: 10\\%
    expect(filtroBusquedaNegocio('10%')).toBe('codigo.ilike."%10\\\\%%",nombre.ilike."%10\\\\%%"')
  })

  it('las comillas y la barra del término se escapan para PostgREST', () => {
    expect(valorEntreComillas('a"b\\c')).toBe('"a\\"b\\\\c"')
  })
})
