import { describe, expect, it } from 'vitest'
import { codigoCampana, leerAgenda, leerLineaAgenda, lecturaCorta, nombreCampana } from './agenda-texto'

// «Ahora»: jueves 22 de octubre de 2026, 10:00 a. m. de Bogotá.
const AHORA = Date.parse('2026-10-22T10:00:00-05:00')
const leer = (l: string) => leerLineaAgenda(l, AHORA)
const ok = (l: string) => {
  const r = leer(l)
  if (!r.ok) throw new Error(`«${l}»: ${r.error}`)
  return r
}
const falla = (l: string) => {
  const r = leer(l)
  if (r.ok) throw new Error(`«${l}» se leyó como ${r.lectura}`)
  return r.error
}

describe('la agenda de Sabor, una hora por línea (P3)', () => {
  it('lee las líneas del diseño con su lectura completa', () => {
    expect([ok('sábado 24 a la 1').fecha, ok('sábado 24 a la 1').hora, ok('sábado 24 a la 1').lectura]).toEqual(['2026-10-24', '13:00', 'sáb 24 oct · 1:00 p. m.'])
    expect(ok('sábado 24 a las 5').lectura).toBe('sáb 24 oct · 5:00 p. m.')
    expect(ok('domingo 25 a las 7').lectura).toBe('dom 25 oct · 7:00 p. m.')
  })

  it('de 1 a 11 sin «a. m.» es p. m., y lo dice; con «a. m.», mañana', () => {
    expect([ok('sábado 24 a las 7').hora, ok('sábado 24 a las 7').supuestoPm]).toEqual(['19:00', true])
    expect([ok('sábado 24 a las 10 a. m.').hora, ok('sábado 24 a las 10 a. m.').supuestoPm]).toEqual(['10:00', false])
    expect(ok('sábado 24 a las 11 de la mañana').hora).toBe('11:00')
    expect(ok('sábado 24 a las 7 de la noche').hora).toBe('19:00')
    expect(ok('sábado 24 a las 12').hora).toBe('12:00')
    expect(ok('sábado 24 19:30').lectura).toBe('sáb 24 oct · 7:30 p. m.')
    expect(ok('24 oct 7pm').hora).toBe('19:00')
    expect(ok('sábado 24 a las 7 y media').hora).toBe('19:30')
  })

  it('«5 y 7» y dos días en una línea quedan en rojo', () => {
    expect(falla('dom 25 a las 5 y 7')).toMatch(/Una hora por línea/)
    expect(falla('sábado 24 a las 5, 7')).toMatch(/Una hora por línea/)
    expect(falla('sábado 24 a las 5 y a las 7')).toMatch(/Una hora por línea/)
    expect(falla('sábado 24 y domingo 25 a las 7')).toMatch(/Un día por línea/)
  })

  it('un día que no cuadra con la fecha queda en rojo', () => {
    expect(falla('sábado 25 a las 7')).toBe('«sábado 25» no cuadra: el 25 de octubre es domingo.')
    expect(falla('viernes 24 de octubre a las 8')).toMatch(/no cuadra/)
  })

  it('sin mes, el próximo con ese número; sin año, el próximo', () => {
    // Hoy es 22 de octubre: el 5 es de noviembre.
    expect(ok('jueves 5 a las 7').fecha).toBe('2026-11-05')
    expect(ok('martes 5 de enero a las 7').fecha).toBe('2027-01-05')
    expect(ok('24/10 a las 7').fecha).toBe('2026-10-24')
    expect(ok('sábado 24 de octubre de 2026 a las 7').fecha).toBe('2026-10-24')
  })

  it('lo que no se entiende, lo que ya pasó o no existe, en rojo', () => {
    expect(falla('sábado 24')).toMatch(/Falta la hora/)
    expect(falla('a las 7')).toMatch(/Falta el día/)
    expect(falla('jueves 22 a las 9 a. m.')).toMatch(/ya pasó/)
    expect(falla('31 de noviembre a las 7')).toMatch(/no existe/)
    expect(falla('sábado 24 a las 25:00')).toMatch(/no existe/)
  })

  it('la lista: las vacías no cuentan y las repetidas quedan en rojo', () => {
    const r = leerAgenda('sábado 24 a la 1\n\nsábado 24 a las 5\nsáb 24 13:00\n', AHORA)
    expect(r.map((x) => x.ok)).toEqual([true, true, false])
    expect(r[2].ok ? '' : r[2].error).toMatch(/Repetida/)
  })
})

describe('nombre y código de la campaña', () => {
  it('salen solos de la experiencia y la primera función', () => {
    expect(nombreCampana('Harry Potter', '2026-10-24')).toBe('Harry Potter octubre')
    expect(codigoCampana('Harry Potter', '2026-10-24')).toBe('HP-OCT26')
    expect(codigoCampana('El extraño mundo de Jack', '2026-11-07')).toBe('EMJ-NOV26')
    expect(codigoCampana('Ratatouille', '2027-01-09')).toBe('R-ENE27')
    expect(codigoCampana('¡!', '2027-01-09')).toBe('C-ENE27')
    expect(lecturaCorta('2026-10-25', '00:30')).toBe('dom 25 oct · 12:30 a. m.')
  })
})
