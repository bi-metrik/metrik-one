import { describe, it, expect } from 'vitest'
import {
  serializarFiltro, parsearFiltro, aplicarFiltroEnQuery, filtroDesdeSearchParams,
} from './url-estado'

describe('filtroDesdeSearchParams', () => {
  it('resuelve el filtro que el servidor debe pintar en el primer render', () => {
    expect(filtroDesdeSearchParams({ q: 'abogal' }, 'q', '')).toBe('abogal')
    expect(filtroDesdeSearchParams({ atrasados: '1' }, 'atrasados', false)).toBe(true)
  })

  it('sin el parametro, manda el default (que puede depender del rol)', () => {
    expect(filtroDesdeSearchParams({}, 'responsable', 'mios')).toBe('mios')
    expect(filtroDesdeSearchParams(undefined, 'fase', 'todos')).toBe('todos')
  })

  it('un parametro repetido no rompe: gana el primero', () => {
    expect(filtroDesdeSearchParams({ fase: ['venta', 'cobro'] }, 'fase', 'todos')).toBe('venta')
  })

  it('un valor fuera del conjunto admisible cae al default', () => {
    const fases = ['todos', 'venta', 'cobro'] as const
    expect(filtroDesdeSearchParams({ fase: 'basura' }, 'fase', 'todos', fases)).toBe('todos')
  })

  it('coincide con lo que leeria el cliente de la misma URL', () => {
    // Este acuerdo es el que evita el desajuste de hidratacion: si servidor y cliente
    // resolvieran distinto, React descarta el HTML y la lista parpadea.
    const params = { q: 'abogal', atrasados: '1', etapa: '12' }
    expect(filtroDesdeSearchParams(params, 'q', '')).toBe(parsearFiltro('abogal', ''))
    expect(filtroDesdeSearchParams(params, 'atrasados', false)).toBe(parsearFiltro('1', false))
    expect(filtroDesdeSearchParams(params, 'etapa', null)).toBe(parsearFiltro('12', null))
  })
})

describe('serializarFiltro', () => {
  it('un filtro en su valor por defecto no viaja en la URL', () => {
    expect(serializarFiltro('todos', 'todos')).toBeNull()
    expect(serializarFiltro(false, false)).toBeNull()
  })

  it('un valor elegido viaja como texto', () => {
    expect(serializarFiltro('venta', 'todos')).toBe('venta')
    expect(serializarFiltro(7, null)).toBe('7')
  })

  it('los booleanos viajan como 1/0, no como "true"/"false"', () => {
    expect(serializarFiltro(true, false)).toBe('1')
  })

  it('null y cadena vacia no viajan: son "sin elegir", igual que el default', () => {
    expect(serializarFiltro(null, 'todos')).toBeNull()
    expect(serializarFiltro('', 'todos')).toBeNull()
  })
})

describe('parsearFiltro', () => {
  it('sin parametro, manda el valor por defecto', () => {
    expect(parsearFiltro(null, 'todos')).toBe('todos')
    expect(parsearFiltro('', 'todos')).toBe('todos')
  })

  it('devuelve el tipo del valor por defecto, no siempre texto', () => {
    expect(parsearFiltro('7', 0)).toBe(7)
    expect(parsearFiltro('1', false)).toBe(true)
    expect(parsearFiltro('0', false)).toBe(false)
    expect(parsearFiltro('venta', 'todos')).toBe('venta')
  })

  it('un texto que no encaja con el tipo cae al default, no produce NaN', () => {
    // URL manipulada a mano: la lista debe quedar sin filtrar, nunca mostrando NaN.
    expect(parsearFiltro('abc', 0)).toBe(0)
    expect(parsearFiltro('quiza', false)).toBe(false)
  })

  it('con default null, un numero vuelve como numero (etapa) y el resto como texto', () => {
    expect(parsearFiltro('12', null)).toBe(12)
    expect(parsearFiltro('bogota', null)).toBe('bogota')
  })
})

describe('aplicarFiltroEnQuery', () => {
  it('agrega el parametro elegido', () => {
    expect(aplicarFiltroEnQuery('', 'fase', 'venta', 'todos')).toBe('fase=venta')
  })

  it('al volver al default, el parametro se borra', () => {
    expect(aplicarFiltroEnQuery('fase=venta', 'fase', 'todos', 'todos')).toBe('')
  })

  it('preserva los demas filtros ya presentes', () => {
    const q = aplicarFiltroEnQuery('fase=venta&q=abogal', 'seccional', 'Bogotá', 'todas')
    const p = new URLSearchParams(q)
    expect(p.get('fase')).toBe('venta')
    expect(p.get('q')).toBe('abogal')
    expect(p.get('seccional')).toBe('Bogotá')
  })

  it('preserva parametros AJENOS a los filtros', () => {
    // El Directorio enlaza a /negocios/nuevo?contacto_id=… y hay vistas que llegan con
    // parametros propios: filtrar no puede borrarlos.
    const q = aplicarFiltroEnQuery('empresa_id=abc', 'fase', 'venta', 'todos')
    expect(new URLSearchParams(q).get('empresa_id')).toBe('abc')
  })

  it('cambiar dos filtros seguidos no pisa el primero', () => {
    const q1 = aplicarFiltroEnQuery('', 'fase', 'venta', 'todos')
    const q2 = aplicarFiltroEnQuery(q1, 'responsable', 'daniela', 'todos')
    const p = new URLSearchParams(q2)
    expect(p.get('fase')).toBe('venta')
    expect(p.get('responsable')).toBe('daniela')
  })
})
