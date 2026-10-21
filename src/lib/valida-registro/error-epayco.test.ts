import { describe, expect, it } from 'vitest'
import { asegurarSesionEpayco, textoErrorEpayco } from './error-epayco'

describe('textoErrorEpayco', () => {
  it('un campo que no pasa la validación de ePayco.js nombra el campo', () => {
    expect(textoErrorEpayco('El formato es incorrecto o esta vacío en: number')).toBe(
      'Revisa el número de la tarjeta: está vacío o no tiene el formato correcto.',
    )
    expect(textoErrorEpayco('El formato es incorrecto o esta vacío en: date_exp')).toContain('la fecha de vencimiento')
    expect(textoErrorEpayco('El formato es incorrecto o esta vacío en: email')).toContain('el correo')
  })

  it('un rechazo de la API muestra la descripción de ePayco sin el prefijo genérico', () => {
    const respuesta = {
      status: false,
      message: 'Error inesperado',
      data: { status: 'error', description: 'Error general contacte con soporte. Bin credit card no valid.' },
    }
    expect(textoErrorEpayco(respuesta)).toBe('ePayco rechazó la tarjeta: Bin credit card no valid.')
  })

  it('sin descripción usa el mensaje, y sin nada un texto genérico', () => {
    expect(textoErrorEpayco({ message: 'Llave inválida' })).toBe('ePayco rechazó la tarjeta: Llave inválida')
    expect(textoErrorEpayco({})).toBe('ePayco rechazó la tarjeta. Revisa los datos e inténtalo de nuevo.')
  })

  it('una respuesta sin token y sin error no se confunde con un rechazo', () => {
    expect(textoErrorEpayco(undefined)).toContain('no devolvió')
    expect(textoErrorEpayco(null)).toContain('no devolvió')
  })
})

describe('asegurarSesionEpayco', () => {
  function almacen(inicial: Record<string, string> = {}) {
    const m = new Map(Object.entries(inicial))
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
  }

  it('crea la sesión antes del primer intento', () => {
    const a = almacen()
    asegurarSesionEpayco(a, () => 'nueva')
    expect(a.m.get('keyUserIndex')).toBe('nueva')
  })

  it('no reemplaza la que ya existe', () => {
    const a = almacen({ keyUserIndex: 'vieja' })
    asegurarSesionEpayco(a, () => 'nueva')
    expect(a.m.get('keyUserIndex')).toBe('vieja')
  })

  it('sin almacenamiento no revienta', () => {
    const roto = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {},
    }
    expect(() => asegurarSesionEpayco(roto, () => 'x')).not.toThrow()
  })
})
