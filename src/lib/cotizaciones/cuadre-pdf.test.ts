import { describe, it, expect } from 'vitest'
import { calcularCascada } from './totales'

/**
 * El documento que recibe el cliente tiene que cuadrar consigo mismo.
 *
 * EL CASO QUE IMPORTA: la cotización se imprime como una columna de valores por ítem
 * y un total al pie. El cliente suma la columna. En COT-2026-0003 de Termotech los 12
 * ítems sumaban 153.655.471 contra un "TOTAL NETO" de 153.655.469, porque el total
 * salía de redondear la suma exacta y cada línea se redondeaba aparte.
 *
 * Son dos pesos, y por eso vivió tanto: nadie lo mira en una prueba con un solo ítem
 * de números redondos. Lo que lo destapa son VARIOS ítems con decimales que caen para
 * el mismo lado, que es exactamente la cotización real.
 *
 * ⚠️ El control importa: la invariante no puede probarse solo con cifras que ya
 * cuadraban. Cada caso aquí produce decimales, y el primero reproduce los 12 ítems.
 */

/** La columna que se imprime: precio unitario redondeado, por cantidad. */
function sumaDeLaColumnaImpresa(cascada: ReturnType<typeof calcularCascada>, items: { id: string; cantidad?: number }[]) {
  return cascada.lineas.reduce((suma, linea) => {
    const cantidad = items.find(i => i.id === linea.id)?.cantidad ?? 1
    // Es lo que `recalcularTotales` guarda en `items.precio_venta` y lo que el PDF
    // multiplica por la cantidad para imprimir "VLR. TOTAL".
    return suma + Math.round(linea.precioLinea / cantidad) * cantidad
  }, 0)
}

function cascadaDe(costos: { id: string; subtotal: number; cantidad?: number }[], margenPct: number) {
  const items = costos.map(c => ({
    id: c.id,
    subtotal: c.subtotal,
    cantidad: c.cantidad ?? 1,
    numeroDeRubros: 0,
    margen_porcentaje: null,
  }))
  return { cascada: calcularCascada(items, { margenPct, convencionMargen: 'markup' as const }), items }
}

describe('la columna impresa cuadra con el total', () => {
  it('los 12 ítems de COT-2026-0003 al 23,99%', () => {
    // Los costos reales, que con markup 23,99 producen los valores del PDF.
    const { cascada, items } = cascadaDe([
      { id: '01', subtotal: 12_495_000 },
      { id: '02', subtotal: 10_710_000 },
      { id: '03', subtotal: 4_581_500 },
      { id: '04', subtotal: 19_040_000 },
      { id: '05', subtotal: 60_000_000 },
      { id: '06', subtotal: 4_165_000 },
      { id: '07', subtotal: 714_000 },
      { id: '08', subtotal: 496_695 },
      { id: '09', subtotal: 2_380_000 },
      { id: '10', subtotal: 5_000_000 },
      { id: '11', subtotal: 1_963_500 },
      { id: '12', subtotal: 2_380_000 },
    ], 23.99)

    expect(sumaDeLaColumnaImpresa(cascada, items)).toBe(cascada.precioVenta)
  })

  it('con cantidades mayores a 1, que es donde el unitario redondeado se multiplica', () => {
    const { cascada, items } = cascadaDe([
      { id: 'a', subtotal: 333_333, cantidad: 3 },
      { id: 'b', subtotal: 666_667, cantidad: 7 },
      { id: 'c', subtotal: 100_001, cantidad: 11 },
    ], 17.5)

    expect(sumaDeLaColumnaImpresa(cascada, items)).toBe(cascada.precioVenta)
  })

  it('con la convención sobre venta, que divide y deja más decimales', () => {
    const items = [
      { id: 'a', subtotal: 1_000_000, cantidad: 2, numeroDeRubros: 0, margen_porcentaje: null },
      { id: 'b', subtotal: 777_777, cantidad: 3, numeroDeRubros: 0, margen_porcentaje: null },
    ]
    const cascada = calcularCascada(items, { margenPct: 15, convencionMargen: 'sobre_venta' })
    expect(sumaDeLaColumnaImpresa(cascada, items)).toBe(cascada.precioVenta)
  })

  it('con administrativos encima del costo, que reparten decimales por línea', () => {
    const items = [
      { id: 'a', subtotal: 1_234_567, cantidad: 1, numeroDeRubros: 0, margen_porcentaje: null },
      { id: 'b', subtotal: 7_654_321, cantidad: 4, numeroDeRubros: 0, margen_porcentaje: null },
      { id: 'c', subtotal: 999_999, cantidad: 9, numeroDeRubros: 0, margen_porcentaje: null },
    ]
    const cascada = calcularCascada(items, { administrativosPct: 7.5, margenPct: 23.99 })
    expect(sumaDeLaColumnaImpresa(cascada, items)).toBe(cascada.precioVenta)
  })

  it('una línea con margen propio tampoco descuadra la columna', () => {
    const items = [
      { id: 'a', subtotal: 1_000_003, cantidad: 3, numeroDeRubros: 0, margen_porcentaje: null },
      { id: 'b', subtotal: 2_000_007, cantidad: 7, numeroDeRubros: 0, margen_porcentaje: 41.7 },
    ]
    const cascada = calcularCascada(items, { margenPct: 23.99 })
    expect(sumaDeLaColumnaImpresa(cascada, items)).toBe(cascada.precioVenta)
  })
})
