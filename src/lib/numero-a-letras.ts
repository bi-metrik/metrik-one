/**
 * Convierte un número a su representación en letras en español.
 * Soporta hasta billones. Optimizado para montos en COP.
 */
export function numeroALetras(num: number): string {
  const unidades = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']
  const decenas = ['', 'diez', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
  const especiales: Record<number, string> = {
    11: 'once', 12: 'doce', 13: 'trece', 14: 'catorce', 15: 'quince',
    16: 'dieciséis', 17: 'diecisiete', 18: 'dieciocho', 19: 'diecinueve',
    21: 'veintiún', 22: 'veintidós', 23: 'veintitrés', 24: 'veinticuatro',
    25: 'veinticinco', 26: 'veintiséis', 27: 'veintisiete', 28: 'veintiocho', 29: 'veintinueve',
  }
  const centenas = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

  if (num === 0) return 'cero'
  if (num === 100) return 'cien'
  if (num === 1000000) return 'un millón'

  let resultado = ''

  // Millones
  if (num >= 1000000) {
    const millones = Math.floor(num / 1000000)
    if (millones === 1) {
      resultado += 'un millón '
    } else {
      resultado += numeroALetras(millones) + ' millones '
    }
    num %= 1000000
  }

  // Miles
  if (num >= 1000) {
    const miles = Math.floor(num / 1000)
    if (miles === 1) {
      resultado += 'mil '
    } else {
      resultado += numeroALetras(miles) + ' mil '
    }
    num %= 1000
  }

  // Centenas
  if (num >= 100) {
    resultado += centenas[Math.floor(num / 100)] + ' '
    num %= 100
  }

  // Decenas y unidades
  if (num > 0) {
    if (especiales[num]) {
      resultado += especiales[num]
    } else if (num < 10) {
      resultado += unidades[num]
    } else {
      const dec = Math.floor(num / 10)
      const uni = num % 10
      resultado += decenas[dec]
      if (uni > 0) {
        resultado += ' y ' + unidades[uni]
      }
    }
  }

  return resultado.trim()
}
