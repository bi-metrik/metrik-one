import { describe, expect, it } from 'vitest'
import {
  consultaMencion,
  filtrarEquipo,
  nombreResponsable,
  normalizarResponsable,
  resolverMencionEscrita,
} from './responsable'

const equipo = [
  { id: 's1', full_name: 'Laura Gómez' },
  { id: 's2', full_name: 'Jhon Mosquera' },
  { id: 's3', full_name: 'José Álvarez' },
  { id: 's4', full_name: 'Laura Pérez' },
  { id: 's5', full_name: null },
]

describe('normalizarResponsable', () => {
  it('la persona gana sobre el texto', () => {
    expect(normalizarResponsable({ responsable_id: 's1', responsable_texto: 'Contratista' }))
      .toEqual({ responsable_id: 's1', responsable_texto: null })
  })

  it('texto vacío o de espacios es ausencia, no un responsable llamado «»', () => {
    expect(normalizarResponsable({ responsable_texto: '   ' })).toEqual({ responsable_id: null, responsable_texto: null })
  })

  it('compacta espacios y recorta a 80', () => {
    expect(normalizarResponsable({ responsable_texto: '  Electro   Andina ' }).responsable_texto).toBe('Electro Andina')
    expect(normalizarResponsable({ responsable_texto: 'x'.repeat(120) }).responsable_texto).toHaveLength(80)
  })
})

describe('consultaMencion', () => {
  it('detecta la arroba al inicio o tras un espacio', () => {
    expect(consultaMencion('@lau')).toBe('lau')
    expect(consultaMencion('@')).toBe('')
    expect(consultaMencion('Apoyo de @jh')).toBe('jh')
  })

  it('una arroba pegada a una palabra no es mención', () => {
    expect(consultaMencion('compras@empresa')).toBeNull()
    expect(consultaMencion('Contratista')).toBeNull()
  })
})

describe('filtrarEquipo', () => {
  it('encuentra por el inicio de cualquier palabra y sin tildes', () => {
    expect(filtrarEquipo(equipo, 'mosq').map(m => m.id)).toEqual(['s2'])
    expect(filtrarEquipo(equipo, 'jose').map(m => m.id)).toEqual(['s3'])
    expect(filtrarEquipo(equipo, 'alv').map(m => m.id)).toEqual(['s3'])
  })

  it('sin consulta devuelve el equipo con nombre, sin los que no tienen', () => {
    expect(filtrarEquipo(equipo, '').map(m => m.id)).toEqual(['s1', 's2', 's3', 's4'])
  })

  it('no confunde el medio de una palabra con su inicio', () => {
    expect(filtrarEquipo(equipo, 'ura')).toEqual([])
  })
})

describe('resolverMencionEscrita', () => {
  it('«@nombre completo» de una sola persona se vuelve esa persona', () => {
    expect(resolverMencionEscrita('@laura gomez', equipo)).toEqual({ responsable_id: 's1', responsable_texto: null })
  })

  it('si el nombre no identifica a una sola persona, queda como texto', () => {
    expect(resolverMencionEscrita('@Laura', equipo)).toEqual({ responsable_id: null, responsable_texto: '@Laura' })
  })

  it('texto sin arroba nunca se convierte en persona', () => {
    expect(resolverMencionEscrita('Laura Gómez', equipo)).toEqual({ responsable_id: null, responsable_texto: 'Laura Gómez' })
  })
})

describe('nombreResponsable', () => {
  it('prefiere el nombre de la persona y cae al texto', () => {
    expect(nombreResponsable({ responsable_id: 's2' }, equipo)).toBe('Jhon Mosquera')
    expect(nombreResponsable({ responsable_texto: 'Constructora Ríos' }, equipo)).toBe('Constructora Ríos')
    expect(nombreResponsable({ responsable_id: 'fuera', responsable_texto: null }, new Map([['s1', 'Laura']]))).toBeNull()
  })
})
