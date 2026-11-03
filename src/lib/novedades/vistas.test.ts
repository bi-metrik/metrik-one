import { describe, it, expect } from 'vitest'
import { NOVEDADES, type Novedad } from './novedades'
import { contarNoVistas, novedadesDelEspacio, novedadAplica, parsearVistas } from './vistas'

const n = (id: string, fecha: string, producto?: Novedad['producto']): Novedad => ({
  id,
  fecha,
  titulo: id,
  texto: id,
  producto,
})

const ctx = (modules: Record<string, boolean>, extra: Partial<{ modoVitrina: boolean; platformAdmin: boolean }> = {}) => ({
  modules,
  modoVitrina: false,
  platformAdmin: false,
  ...extra,
})

describe('el archivo de novedades', () => {
  it('cada id es único y cada fecha es YYYY-MM-DD válida', () => {
    const ids = NOVEDADES.map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const x of NOVEDADES) {
      expect(x.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(x.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(new Date(`${x.fecha}T00:00:00Z`).toISOString().slice(0, 10)).toBe(x.fecha)
      expect(x.titulo.trim()).not.toBe('')
      expect(x.texto.trim()).not.toBe('')
    }
  })
})

describe('qué novedades le tocan al espacio', () => {
  it('sin producto, todos; con producto, solo quien tiene el módulo', () => {
    expect(novedadAplica(n('a', '2026-10-01'), ctx({ business: true }))).toBe(true)
    expect(novedadAplica(n('v', '2026-10-01', 'valida'), ctx({ business: true }))).toBe(false)
    expect(novedadAplica(n('v', '2026-10-01', 'valida'), ctx({ valida_consulta: true }))).toBe(true)
  })

  it('el shell de vitrina es de Valida aunque no tenga la llave', () => {
    expect(novedadAplica(n('v', '2026-10-01', 'valida'), ctx({}, { modoVitrina: true }))).toBe(true)
    expect(novedadAplica(n('c', '2026-10-01', 'clarity'), ctx({}, { modoVitrina: true }))).toBe(false)
  })

  it('el soporte de MéTRIK en su espacio las ve todas', () => {
    expect(novedadAplica(n('v', '2026-10-01', 'valida'), ctx({ business: true }, { platformAdmin: true }))).toBe(true)
  })

  it('un espacio sin `modules` es Clarity, como en el gate', () => {
    expect(novedadAplica(n('c', '2026-10-01', 'clarity'), { modules: null, modoVitrina: false, platformAdmin: false })).toBe(true)
  })

  it('ordena la más reciente arriba; a igual fecha respeta el archivo', () => {
    const lista = novedadesDelEspacio(
      [n('vieja', '2026-09-01'), n('nueva-1', '2026-10-21'), n('nueva-2', '2026-10-21'), n('media', '2026-10-01')],
      ctx({ business: true }),
    )
    expect(lista.map((x) => x.id)).toEqual(['nueva-1', 'nueva-2', 'media', 'vieja'])
  })
})

describe('el numerito', () => {
  const lista = [n('a', '2026-10-21'), n('b', '2026-10-20'), n('c', '2026-07-01')]

  it('cuenta las no vistas dentro de la ventana', () => {
    expect(contarNoVistas(lista, [], '2026-10-21')).toBe(2)
    expect(contarNoVistas(lista, ['a'], '2026-10-21')).toBe(1)
    expect(contarNoVistas(lista, ['a', 'b'], '2026-10-21')).toBe(0)
  })

  it('una entrada nueva cuenta aunque su fecha sea igual o anterior a la última apertura', () => {
    expect(contarNoVistas([...lista, n('d', '2026-10-19')], ['a', 'b'], '2026-10-21')).toBe(1)
  })

  it('sin almacenamiento (null) no hay numerito', () => {
    expect(contarNoVistas(lista, null, '2026-10-21')).toBe(0)
  })

  it('lo guardado se lee con tolerancia', () => {
    expect(parsearVistas(null)).toBeNull()
    expect(parsearVistas('')).toEqual([])
    expect(parsearVistas('no-json')).toEqual([])
    expect(parsearVistas('{"a":1}')).toEqual([])
    expect(parsearVistas('["a",2,"b"]')).toEqual(['a', 'b'])
  })
})
