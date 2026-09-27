import { describe, expect, it } from 'vitest'
import {
  debeSalirHoy,
  diaSemanaISO,
  esDiaHabil,
  normalizarPais,
  siguienteDiaHabil,
  tieneCalendarioDeFestivos,
} from './dias-habiles'
import { festivosColombia } from './festivos-colombia'
import * as copiaEdge from '../../../supabase/functions/_shared/dias-habiles'
import { todayBogotaISO } from './bogota'

const LUNES = 1
const MARTES = 2
const VIERNES = 5

describe('esDiaHabil', () => {
  it('Colombia: lunes a viernes que no sean festivo', () => {
    expect(esDiaHabil('2026-09-25', 'CO')).toBe(true) // viernes
    expect(esDiaHabil('2026-09-26', 'CO')).toBe(false) // sabado
    expect(esDiaHabil('2026-09-27', 'CO')).toBe(false) // domingo
    expect(esDiaHabil('2026-10-12', 'CO')).toBe(false) // lunes festivo (Dia de la Raza)
    expect(esDiaHabil('2026-04-02', 'CO')).toBe(false) // jueves santo
  })

  it('sin pais o con un dato ilegible se usa Colombia', () => {
    expect(normalizarPais(null)).toBe('CO')
    expect(normalizarPais('')).toBe('CO')
    expect(normalizarPais('colombia')).toBe('CO')
    expect(normalizarPais(' mx ')).toBe('MX')
    expect(esDiaHabil('2026-10-12', null)).toBe(false)
  })

  it('otro pais sin calendario cargado solo salta el fin de semana', () => {
    expect(tieneCalendarioDeFestivos('MX')).toBe(false)
    expect(tieneCalendarioDeFestivos('CO')).toBe(true)
    expect(esDiaHabil('2026-10-12', 'MX')).toBe(true) // festivo colombiano, no mexicano
    expect(esDiaHabil('2026-09-26', 'MX')).toBe(false)
  })

  it('todos los festivos calculados de Colombia quedan fuera, 2025 a 2030', () => {
    for (let anio = 2025; anio <= 2030; anio++) {
      for (const f of festivosColombia(anio)) expect(esDiaHabil(f.fecha, 'CO'), f.fecha).toBe(false)
    }
  })
})

describe('siguienteDiaHabil', () => {
  it('un dia habil se queda donde esta', () => {
    expect(siguienteDiaHabil('2026-09-25', 'CO')).toBe('2026-09-25')
  })

  it('el sabado y el domingo se corren al lunes', () => {
    expect(siguienteDiaHabil('2026-09-26', 'CO')).toBe('2026-09-28')
    expect(siguienteDiaHabil('2026-09-27', 'CO')).toBe('2026-09-28')
  })

  it('un puente festivo se corre al martes', () => {
    // Sabado 10, domingo 11 y lunes 12 de octubre de 2026 (festivo).
    expect(siguienteDiaHabil('2026-10-10', 'CO')).toBe('2026-10-13')
  })

  it('Semana Santa: del jueves santo al lunes de pascua', () => {
    expect(siguienteDiaHabil('2026-04-02', 'CO')).toBe('2026-04-06')
  })

  it('estrictamente despues cuando se pide', () => {
    expect(siguienteDiaHabil('2026-09-25', 'CO', false)).toBe('2026-09-28')
  })

  it('fin de año: el 31-dic-2026 es jueves habil; el 1-ene-2027 (viernes) es festivo y se corre al lunes 4', () => {
    expect(siguienteDiaHabil('2026-12-31', 'CO')).toBe('2026-12-31')
    expect(siguienteDiaHabil('2027-01-01', 'CO')).toBe('2027-01-04')
  })
})

describe('debeSalirHoy — el aviso periodico se corre, no se pierde', () => {
  it('el resumen de los lunes sale el lunes habil', () => {
    expect(diaSemanaISO('2026-09-28')).toBe(LUNES)
    expect(debeSalirHoy('2026-09-28', [LUNES], 'CO')).toBe(true)
    expect(debeSalirHoy('2026-09-29', [LUNES], 'CO')).toBe(false)
  })

  it('si el lunes es festivo, sale el martes, y solo el martes', () => {
    // Lunes 12-oct-2026 festivo.
    expect(debeSalirHoy('2026-10-12', [LUNES], 'CO')).toBe(false)
    expect(debeSalirHoy('2026-10-13', [LUNES], 'CO')).toBe(true)
    expect(debeSalirHoy('2026-10-14', [LUNES], 'CO')).toBe(false)
  })

  it('en otro pais sin festivos cargados, el lunes 12-oct sale normal', () => {
    expect(debeSalirHoy('2026-10-12', [LUNES], 'MX')).toBe(true)
    expect(debeSalirHoy('2026-10-13', [LUNES], 'MX')).toBe(false)
  })

  it('martes y viernes: cada uno se corre por su cuenta', () => {
    // Semana Santa 2026: jueves 2 y viernes 3 de abril festivos.
    expect(debeSalirHoy('2026-03-31', [MARTES, VIERNES], 'CO')).toBe(true) // martes habil
    expect(debeSalirHoy('2026-04-03', [MARTES, VIERNES], 'CO')).toBe(false) // viernes santo
    expect(debeSalirHoy('2026-04-06', [MARTES, VIERNES], 'CO')).toBe(true) // lunes: el del viernes
    expect(debeSalirHoy('2026-04-07', [MARTES, VIERNES], 'CO')).toBe(true) // martes normal
  })

  it('un fin de semana nunca dispara', () => {
    expect(debeSalirHoy('2026-09-26', [1, 2, 3, 4, 5, 6, 7], 'CO')).toBe(false)
  })

  it('una semana entera de dias habiles dispara exactamente una vez por dia programado', () => {
    // Recorre 2026 completo: cada lunes programado produce un solo disparo, y cae en el
    // primer dia habil desde ese lunes.
    let disparos = 0
    let lunes = 0
    for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2027, 0, 1); ms += 86_400_000) {
      const f = new Date(ms).toISOString().slice(0, 10)
      if (diaSemanaISO(f) === LUNES) lunes++
      if (debeSalirHoy(f, [LUNES], 'CO')) {
        disparos++
        expect(esDiaHabil(f, 'CO')).toBe(true)
      }
    }
    expect(disparos).toBe(lunes)
  })
})

describe('la copia de las edge functions es identica a la fuente', () => {
  it('esDiaHabil, siguienteDiaHabil y debeSalirHoy coinciden dia por dia de 2025 a 2035', () => {
    const programas = [[LUNES], [MARTES, VIERNES]]
    for (let ms = Date.UTC(2025, 0, 1); ms < Date.UTC(2036, 0, 1); ms += 86_400_000) {
      const f = new Date(ms).toISOString().slice(0, 10)
      for (const pais of ['CO', 'MX', null]) {
        expect(copiaEdge.esDiaHabil(f, pais), `${f} ${pais}`).toBe(esDiaHabil(f, pais))
        expect(copiaEdge.siguienteDiaHabil(f, pais)).toBe(siguienteDiaHabil(f, pais))
        for (const p of programas) expect(copiaEdge.debeSalirHoy(f, p, pais)).toBe(debeSalirHoy(f, p, pais))
      }
    }
  })

  it('los festivos de la copia son los mismos de festivos-colombia.ts', () => {
    for (let anio = 2025; anio <= 2100; anio++) {
      const fuente = [...new Set(festivosColombia(anio).map((f) => f.fecha))].sort()
      expect([...copiaEdge.festivosColombia(anio)].sort()).toEqual(fuente)
    }
  })
})

describe('"hoy" para la regla es el dia de Bogota', () => {
  it('el viernes 25-sep a las 20:00 de Bogota (sabado en UTC) todavia es habil', () => {
    const hoy = todayBogotaISO(new Date('2026-09-26T01:00:00Z'))
    expect(hoy).toBe('2026-09-25')
    expect(esDiaHabil(hoy, 'CO')).toBe(true)
  })

  it('el domingo a las 23:59 de Bogota (lunes en UTC) todavia no es habil', () => {
    const hoy = todayBogotaISO(new Date('2026-09-28T04:59:00Z'))
    expect(hoy).toBe('2026-09-27')
    expect(esDiaHabil(hoy, 'CO')).toBe(false)
  })
})
