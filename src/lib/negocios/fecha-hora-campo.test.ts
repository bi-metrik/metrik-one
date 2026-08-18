import { describe, it, expect } from 'vitest'
import {
  sinHoraRegistrada,
  paraInputFechaHora,
  ahoraBogotaCivil,
  esFechaHoraPasada,
  rechazoPorFechaPasada,
  fechaHoraEnLetras,
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

  it('lo pinta como medianoche para que el input no lo borre de la pantalla', () => {
    // Sin esto el `datetime-local` recibe '2026-08-14', no lo entiende y se pinta
    // vacío: la pantalla diría que no hay cita cuando el caso sí la tiene.
    expect(paraInputFechaHora('2026-08-14')).toBe('2026-08-14T00:00')
  })

  it('deja pasar el valor que ya trae hora y descarta la basura', () => {
    expect(paraInputFechaHora('2026-09-26T09:30')).toBe('2026-09-26T09:30')
    expect(paraInputFechaHora('2026-09-26T09:30:00')).toBe('2026-09-26T09:30')
    expect(paraInputFechaHora('14/08/2026')).toBe('')
    expect(paraInputFechaHora(undefined)).toBe('')
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
