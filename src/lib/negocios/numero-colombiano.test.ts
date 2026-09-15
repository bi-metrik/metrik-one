import { describe, it, expect } from 'vitest'
import { parsearNumeroColombiano, formatearNumeroColombiano } from './numero-colombiano'

describe('parsearNumeroColombiano', () => {
  it('lee el punto de miles colombiano — el caso que costó V0498', () => {
    // `Number('769.898')` da 769,898 pesos. Esa es la falla.
    expect(parsearNumeroColombiano('769.898')).toBe(769898)
    expect(parsearNumeroColombiano('770.159')).toBe(770159)
    expect(parsearNumeroColombiano('701.812')).toBe(701812)
  })

  it('lee varios grupos de miles', () => {
    expect(parsearNumeroColombiano('1.997.484')).toBe(1997484)
    expect(parsearNumeroColombiano('12.345.678')).toBe(12345678)
  })

  it('lee el número sin separadores', () => {
    expect(parsearNumeroColombiano('769898')).toBe(769898)
    expect(parsearNumeroColombiano('0')).toBe(0)
  })

  it('descarta el símbolo de moneda y los espacios, incluido el no separable', () => {
    expect(parsearNumeroColombiano('$ 769.898')).toBe(769898)
    expect(parsearNumeroColombiano('$769.898')).toBe(769898)
    expect(parsearNumeroColombiano('769 898')).toBe(769898)
    expect(parsearNumeroColombiano(' 769.898 ')).toBe(769898)
  })

  it('la coma es el decimal y los puntos que la acompañan son miles', () => {
    expect(parsearNumeroColombiano('1.234,56')).toBe(1234.56)
    expect(parsearNumeroColombiano('45,5')).toBe(45.5)
    expect(parsearNumeroColombiano('0,65')).toBe(0.65)
  })

  it('un punto con 1, 2 o 4+ dígitos detrás SIGUE siendo decimal', () => {
    // Los campos `numero` que hoy admiten decimales son porcentajes, un divisor y
    // km/galón. Ninguno puede romperse por la regla de miles.
    expect(parsearNumeroColombiano('45.5')).toBe(45.5)
    expect(parsearNumeroColombiano('12.75')).toBe(12.75)
    expect(parsearNumeroColombiano('0.65')).toBe(0.65)
    expect(parsearNumeroColombiano('1.2345')).toBe(1.2345)
  })

  it('devuelve null cuando no hay número, y NUNCA cero', () => {
    // Un cero es una respuesta; la ausencia de número no lo es. Confundirlos deja
    // pasar un campo vacío como si alguien hubiera escrito 0.
    expect(parsearNumeroColombiano('')).toBeNull()
    expect(parsearNumeroColombiano('   ')).toBeNull()
    expect(parsearNumeroColombiano('pendiente')).toBeNull()
    expect(parsearNumeroColombiano('$')).toBeNull()
    expect(parsearNumeroColombiano(null)).toBeNull()
    expect(parsearNumeroColombiano(undefined)).toBeNull()
    expect(parsearNumeroColombiano({})).toBeNull()
  })

  it('rechaza lo que mezcla dígitos con letras en vez de inventar un número', () => {
    expect(parsearNumeroColombiano('769.898 COP')).toBeNull()
    expect(parsearNumeroColombiano('12a34')).toBeNull()
  })

  it('acepta un número ya resuelto y descarta los no finitos', () => {
    expect(parsearNumeroColombiano(769898)).toBe(769898)
    expect(parsearNumeroColombiano(769.898)).toBe(769.898)
    expect(parsearNumeroColombiano(NaN)).toBeNull()
    expect(parsearNumeroColombiano(Infinity)).toBeNull()
  })

  it('conserva el signo', () => {
    expect(parsearNumeroColombiano('-556.628')).toBe(-556628)
    expect(parsearNumeroColombiano('-45,5')).toBe(-45.5)
  })

  it('no admite dos comas decimales', () => {
    expect(parsearNumeroColombiano('1,2,3')).toBeNull()
  })
})

describe('formatearNumeroColombiano', () => {
  it('devuelve el eco con punto de miles', () => {
    expect(formatearNumeroColombiano(769898)).toBe('769.898')
    expect(formatearNumeroColombiano(1997484)).toBe('1.997.484')
  })

  it('usa coma para los decimales', () => {
    expect(formatearNumeroColombiano(45.5)).toBe('45,5')
  })

  it('devuelve cadena vacía para lo que no es número', () => {
    expect(formatearNumeroColombiano(NaN)).toBe('')
  })
})
