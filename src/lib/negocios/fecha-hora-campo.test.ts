import { describe, it, expect } from 'vitest'
import {
  sinHoraRegistrada,
  ahoraBogotaCivil,
  esFechaHoraPasada,
  rechazoPorFechaPasada,
  fechaHoraEnLetras,
  partesFechaHora,
  componerFechaHora,
  faltaHoraDeCita,
} from './fecha-hora-campo'

// 2026-08-18 15:30 en Bogotá = 20:30 UTC del mismo día.
const AHORA = new Date('2026-08-18T20:30:00Z')

describe('valores heredados de cuando el campo era solo día', () => {
  it('reconoce el valor de solo día', () => {
    expect(sinHoraRegistrada('2026-08-14')).toBe(true)
    expect(sinHoraRegistrada('2026-08-14T09:30')).toBe(false)
    expect(sinHoraRegistrada('')).toBe(false)
    expect(sinHoraRegistrada(null)).toBe(false)
  })
})

describe('el ahora se lee en Bogotá, no en UTC', () => {
  it('proyecta el instante a la hora civil colombiana', () => {
    expect(ahoraBogotaCivil(AHORA)).toBe('2026-08-18T15:30')
  })

  it('no adelanta el día después de las 19:00 de Colombia', () => {
    // 2026-08-18 23:00 Bogotá = 2026-08-19 04:00 UTC. Leerlo en UTC daría el 19 y
    // rechazaría una cita válida del 19 por la mañana.
    expect(ahoraBogotaCivil(new Date('2026-08-19T04:00:00Z'))).toBe('2026-08-18T23:00')
  })
})

describe('una cita no se puede registrar en el pasado', () => {
  it('rechaza el día ya cumplido', () => {
    expect(esFechaHoraPasada('2026-08-14T09:30', AHORA)).toBe(true)
    expect(rechazoPorFechaPasada('1999-01-01T08:00')).toContain('no puede quedar en el pasado')
  })

  it('rechaza una hora anterior del mismo día y acepta una posterior', () => {
    expect(esFechaHoraPasada('2026-08-18T09:00', AHORA)).toBe(true)
    expect(esFechaHoraPasada('2026-08-18T16:00', AHORA)).toBe(false)
  })

  it('acepta la cita futura', () => {
    expect(esFechaHoraPasada('2026-09-26T09:30', AHORA)).toBe(false)
    expect(rechazoPorFechaPasada('2999-01-01T08:00')).toBeNull()
  })

  it('no llama pasado a un campo a medio escribir', () => {
    // El `datetime-local` emite '' mientras el usuario no completa los dos tramos.
    expect(esFechaHoraPasada('', AHORA)).toBe(false)
    expect(esFechaHoraPasada('2026-08', AHORA)).toBe(false)
    expect(esFechaHoraPasada(null, AHORA)).toBe(false)
    expect(rechazoPorFechaPasada('')).toBeNull()
  })

  it('compara el valor de solo día como su medianoche', () => {
    expect(esFechaHoraPasada('2026-08-18', AHORA)).toBe(true)
    expect(esFechaHoraPasada('2026-08-19', AHORA)).toBe(false)
  })
})

describe('la cita en letras para el cliente', () => {
  it('no se rompe con el valor que trae hora', () => {
    // La versión anterior hacía `new Date(iso + 'T00:00:00')`, que con este valor
    // daba Invalid Date y la Guía salía con la cita en blanco, sin avisar.
    expect(fechaHoraEnLetras('2026-09-26T09:30')).toBe('26 de septiembre de 2026, 9:30 a. m.')
  })

  it('distingue mañana de tarde y trata el mediodía y la medianoche como las 12', () => {
    expect(fechaHoraEnLetras('2026-09-26T14:05')).toBe('26 de septiembre de 2026, 2:05 p. m.')
    expect(fechaHoraEnLetras('2026-09-26T12:00')).toBe('26 de septiembre de 2026, 12:00 p. m.')
    expect(fechaHoraEnLetras('2026-09-26T00:30')).toBe('26 de septiembre de 2026, 12:30 a. m.')
  })

  it('con el valor heredado no inventa una hora', () => {
    expect(fechaHoraEnLetras('2026-09-26')).toBe('26 de septiembre de 2026')
  })

  it('devuelve vacío ante lo que no es fecha', () => {
    expect(fechaHoraEnLetras(null)).toBe('')
    expect(fechaHoraEnLetras('')).toBe('')
    expect(fechaHoraEnLetras('26/09/2026')).toBe('')
  })
})

describe('dos casillas: dia y hora', () => {
  it('parte un valor con hora en sus dos casillas', () => {
    expect(partesFechaHora('2026-09-26T09:30')).toEqual({ dia: '2026-09-26', hora: '09:30' })
  })

  it('deja la hora VACIA en un valor heredado de solo dia', () => {
    // Rellenarla con '00:00' es justo el error que este cambio viene a quitar: la
    // pantalla diria una hora que nadie registro.
    expect(partesFechaHora('2026-09-26')).toEqual({ dia: '2026-09-26', hora: '' })
  })

  it('descarta segundos y basura', () => {
    expect(partesFechaHora('2026-09-26T09:30:00')).toEqual({ dia: '2026-09-26', hora: '09:30' })
    expect(partesFechaHora('26/09/2026')).toEqual({ dia: '', hora: '' })
    expect(partesFechaHora(null)).toEqual({ dia: '', hora: '' })
    expect(partesFechaHora('')).toEqual({ dia: '', hora: '' })
  })

  it('compone el valor solo cuando estan las dos casillas', () => {
    expect(componerFechaHora('2026-09-26', '09:30')).toBe('2026-09-26T09:30')
    expect(componerFechaHora('2026-09-26', '09:30:00')).toBe('2026-09-26T09:30')
  })

  it('un dia sin hora NO es una cita', () => {
    // Media cita no cierra el gate: el cliente tiene que saber a que hora enviar.
    expect(componerFechaHora('2026-09-26', '')).toBe('')
    expect(componerFechaHora('', '09:30')).toBe('')
    expect(componerFechaHora(null, null)).toBe('')
  })

  it('ida y vuelta: lo que se compone se vuelve a partir igual', () => {
    const v = componerFechaHora('2026-09-26', '14:05')
    expect(partesFechaHora(v)).toEqual({ dia: '2026-09-26', hora: '14:05' })
  })

  it('senala cuando hay dia pero falta la hora', () => {
    expect(faltaHoraDeCita('2026-09-26', '')).toBe(true)
    expect(faltaHoraDeCita('2026-09-26', '09:30')).toBe(false)
    expect(faltaHoraDeCita('', '')).toBe(false)
    expect(faltaHoraDeCita('', '09:30')).toBe(false)
  })
})
