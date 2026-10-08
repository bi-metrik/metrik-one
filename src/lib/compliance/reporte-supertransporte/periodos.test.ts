import { describe, expect, it } from 'vitest'
import {
  atajoPorDefecto,
  atajosRegulatorios,
  fechaEnPeriodo,
  fechaLimiteRadicacion,
  mesesDelRango,
  paramsDePeriodo,
  resolverPeriodo,
  tramoDelMes,
} from './periodos'

describe('fecha límite de radicación (10 días calendario tras el cierre)', () => {
  it('ago–sep 2026 vence el 10 de octubre', () => {
    expect(fechaLimiteRadicacion('2026-09-30')).toBe('2026-10-10')
  })
  it('oct–dic 2026 vence el 10 de enero de 2027 (cruza el año)', () => {
    expect(fechaLimiteRadicacion('2026-12-31')).toBe('2027-01-10')
  })
  it('ene–mar vence el 10 de abril', () => {
    expect(fechaLimiteRadicacion('2027-03-31')).toBe('2027-04-10')
  })
})

describe('atajos regulatorios', () => {
  it('la transición 2026: may–jul, ago–sep, oct–dic con sus fechas límite', () => {
    const lista = atajosRegulatorios('2026-10-08')
    expect(lista.map((a) => [a.etiqueta, a.desde, a.hasta, a.fechaLimite])).toEqual([
      ['May–jul 2026', '2026-05-01', '2026-07-31', '2026-08-10'],
      ['Ago–sep 2026', '2026-08-01', '2026-09-30', '2026-10-10'],
      ['Oct–dic 2026', '2026-10-01', '2026-12-31', '2027-01-10'],
    ])
  })

  it('desde 2027 siguen trimestres calendario hasta el que está en curso', () => {
    const lista = atajosRegulatorios('2027-05-02')
    expect(lista.slice(3).map((a) => [a.id, a.etiqueta, a.fechaLimite])).toEqual([
      ['2027-01_2027-03', 'Ene–mar 2027', '2027-04-10'],
      ['2027-04_2027-06', 'Abr–jun 2027', '2027-07-10'],
    ])
  })

  it('por defecto abre el que toca radicar: el primero cuyo plazo no ha pasado', () => {
    expect(atajoPorDefecto('2026-10-08').etiqueta).toBe('Ago–sep 2026')
    expect(atajoPorDefecto('2026-10-10').etiqueta).toBe('Ago–sep 2026')
    expect(atajoPorDefecto('2026-10-11').etiqueta).toBe('Oct–dic 2026')
    expect(atajoPorDefecto('2027-01-11').etiqueta).toBe('Ene–mar 2027')
  })
})

describe('resolverPeriodo (la URL)', () => {
  const hoy = '2026-10-08'

  it('sin parámetros cae al periodo por radicar', () => {
    const p = resolverPeriodo({}, hoy)
    expect(p.modo).toBe('atajo')
    expect(p.atajoId).toBe('2026-08_2026-09')
    expect(p.fechaLimite).toBe('2026-10-10')
    expect(p.meses).toEqual(['2026-08', '2026-09'])
    expect(p.enCurso).toBe(false)
  })

  it('un atajo por id, con su fecha límite', () => {
    const p = resolverPeriodo({ periodo: '2026-10_2026-12' }, hoy)
    expect(p.etiqueta).toBe('Oct–dic 2026')
    expect(p.fechaLimite).toBe('2027-01-10')
    expect(p.enCurso).toBe(true)
  })

  it('un id que no es periodo regulatorio no se acepta como atajo', () => {
    const p = resolverPeriodo({ periodo: '2026-02_2026-06' }, hoy)
    expect(p.atajoId).toBe('2026-08_2026-09')
  })

  it('meses sueltos, no contiguos, ordenados y sin repetidos', () => {
    const p = resolverPeriodo({ meses: '2026-10,2026-08,2026-08,basura' }, hoy)
    expect(p.modo).toBe('meses')
    expect(p.meses).toEqual(['2026-08', '2026-10'])
    expect(p.desde).toBe('2026-08-01')
    expect(p.hasta).toBe('2026-10-31')
    expect(p.fechaLimite).toBeNull()
    // septiembre queda AFUERA aunque esté entre los dos
    expect(fechaEnPeriodo('2026-09-15', p)).toBe(false)
    expect(fechaEnPeriodo('2026-10-01', p)).toBe(true)
  })

  it('rango libre', () => {
    const p = resolverPeriodo({ desde: '2026-08-15', hasta: '2026-09-10' }, hoy)
    expect(p.modo).toBe('rango')
    expect(p.meses).toEqual(['2026-08', '2026-09'])
    expect(tramoDelMes('2026-08', p)).toEqual({ desde: '2026-08-15', hasta: '2026-08-31' })
    expect(tramoDelMes('2026-09', p)).toEqual({ desde: '2026-09-01', hasta: '2026-09-10' })
    expect(fechaEnPeriodo('2026-08-14', p)).toBe(false)
  })

  it('un rango invertido o una fecha imposible cae al periodo por defecto', () => {
    expect(resolverPeriodo({ desde: '2026-09-10', hasta: '2026-08-01' }, hoy).modo).toBe('atajo')
    expect(resolverPeriodo({ desde: '2026-02-30', hasta: '2026-03-01' }, hoy).modo).toBe('atajo')
  })

  it('el atajo manda sobre meses y rango', () => {
    const p = resolverPeriodo({ periodo: '2026-05_2026-07', meses: '2026-09', desde: '2026-01-01', hasta: '2026-01-31' }, hoy)
    expect(p.atajoId).toBe('2026-05_2026-07')
  })

  it('ida y vuelta por la URL', () => {
    for (const params of [{ periodo: '2026-05_2026-07' }, { meses: '2026-08,2026-10' }, { desde: '2026-08-15', hasta: '2026-09-10' }]) {
      const p = resolverPeriodo(params, hoy)
      expect(resolverPeriodo(paramsDePeriodo(p), hoy)).toEqual(p)
    }
  })

  it('mesesDelRango cruza el año', () => {
    expect(mesesDelRango('2026-11-20', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
  })
})
