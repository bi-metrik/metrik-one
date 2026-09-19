import { describe, it, expect } from 'vitest'
import { origenDelMargen, etiquetaOrigenMargen, formatMargenPct } from './margen-vista'

describe('origenDelMargen', () => {
  it('una línea sin margen propio HEREDA el de la cotización', () => {
    expect(origenDelMargen({ margenPropio: false, precioManual: false })).toBe('heredado')
  })

  it('una línea con margen propio es una excepción declarada', () => {
    expect(origenDelMargen({ margenPropio: true, precioManual: false })).toBe('propio')
  })

  it('el precio escrito a mano MANDA sobre el margen propio', () => {
    // Las dos marcas pueden convivir: alguien le puso margen propio y después
    // escribió el precio. En ese caso el margen sale del precio, así que apuntar al
    // campo de margen mandaría a tocar el campo que ya no gobierna la cifra.
    expect(origenDelMargen({ margenPropio: true, precioManual: true })).toBe('manual')
    expect(origenDelMargen({ margenPropio: false, precioManual: true })).toBe('manual')
  })
})

describe('origenDelMargen · el margen que puso el pantallazo', () => {
  // Decameron: costo 1.818.919, precio 2.029.118 → 10,359% sobre venta.
  const DEL_PANTALLAZO = 10.359

  it('un margen que coincide con el de la captura es del PROVEEDOR, no propio', () => {
    // El defecto que cierra: los dos viven en `items.margen_porcentaje`, así que sin
    // comparar el número la pantalla decía «margen propio de la línea» en los dos casos
    // y no había forma de saber cuál de nueve líneas revisar.
    expect(origenDelMargen({
      margenPropio: true,
      precioManual: false,
      margenDelPantallazo: DEL_PANTALLAZO,
      margenActual: DEL_PANTALLAZO,
    })).toBe('proveedor')
  })

  it('movido a mano vuelve a ser PROPIO, aunque la captura siga guardada', () => {
    expect(origenDelMargen({
      margenPropio: true,
      precioManual: false,
      margenDelPantallazo: DEL_PANTALLAZO,
      margenActual: 18,
    })).toBe('propio')
  })

  it('una centésima ya es una edición: es el paso de la casilla', () => {
    // La casilla del editor tiene `step="0.01"`. Si el umbral fuera más ancho, una
    // edición real se seguiría anunciando como «lo trae el pantallazo».
    expect(origenDelMargen({
      margenPropio: true,
      precioManual: false,
      margenDelPantallazo: DEL_PANTALLAZO,
      margenActual: DEL_PANTALLAZO + 0.01,
    })).toBe('propio')
  })

  it('el ruido de coma flotante NO cuenta como edición', () => {
    // El número va y vuelve de un `numeric` de Postgres; tratar esa diferencia como
    // una edición pintaría «margen propio» sobre una línea que nadie tocó.
    expect(origenDelMargen({
      margenPropio: true,
      precioManual: false,
      margenDelPantallazo: DEL_PANTALLAZO,
      margenActual: DEL_PANTALLAZO + 1e-9,
    })).toBe('proveedor')
  })

  it('el precio escrito a mano sigue mandando sobre todo lo demás', () => {
    expect(origenDelMargen({
      margenPropio: true,
      precioManual: true,
      margenDelPantallazo: DEL_PANTALLAZO,
      margenActual: DEL_PANTALLAZO,
    })).toBe('manual')
  })

  it('sin captura detrás, el comportamiento de siempre', () => {
    expect(origenDelMargen({
      margenPropio: true,
      precioManual: false,
      margenDelPantallazo: null,
      margenActual: 18,
    })).toBe('propio')
    expect(origenDelMargen({
      margenPropio: false,
      precioManual: false,
      margenDelPantallazo: DEL_PANTALLAZO,
      margenActual: null,
    })).toBe('heredado')
  })
})

describe('etiquetaOrigenMargen', () => {
  it('distingue heredar de marginar aparte: es lo que un 0% no dice solo', () => {
    expect(etiquetaOrigenMargen('heredado')).toContain('hereda')
    expect(etiquetaOrigenMargen('propio')).toContain('propio')
    expect(etiquetaOrigenMargen('manual')).toContain('mano')
  })

  it('el del proveedor se nombra por su fuente, no por «propio»', () => {
    expect(etiquetaOrigenMargen('proveedor')).toContain('pantallazo')
    expect(etiquetaOrigenMargen('proveedor')).not.toContain('propio')
  })

  it('los cuatro orígenes dicen algo distinto', () => {
    const textos = (['heredado', 'propio', 'manual', 'proveedor'] as const).map(etiquetaOrigenMargen)
    expect(new Set(textos).size).toBe(4)
  })
})

describe('formatMargenPct', () => {
  it('un decimal y coma, que es la convención local', () => {
    expect(formatMargenPct(15)).toBe('15,0%')
    expect(formatMargenPct(3.06)).toBe('3,1%')
    expect(formatMargenPct(-6.5)).toBe('-6,5%')
  })

  it('sin margen medible NO devuelve "0,0%"', () => {
    // Un cero afirma que la línea se vende a costo. Lo único cierto cuando no hay
    // precio o no hay costo es que todavía no hay con qué medirla.
    expect(formatMargenPct(null)).toBeNull()
    expect(formatMargenPct(undefined)).toBeNull()
    expect(formatMargenPct(Number.NaN)).toBeNull()
    expect(formatMargenPct(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('el cero REAL sí se imprime', () => {
    expect(formatMargenPct(0)).toBe('0,0%')
  })
})
