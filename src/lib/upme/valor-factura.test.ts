import { describe, it, expect } from 'vitest'
import { valorSinIvaDeFactura } from './valor-factura'

// Una fila del bloque de la Factura del vehículo, como la devuelve la consulta.
const fila = (valor: unknown, campo = 'valor_unitario_sin_iva') => ({
  data: { campos: { [campo]: { value: valor } } } as Record<string, unknown>,
})

describe('valorSinIvaDeFactura — la base de la tarifa UPME', () => {
  // Con `Number(v.replace(/[^\d.-]/g, ''))` el primero daba NaN, o sea «la Factura aún
  // no tiene valor», y la tarifa de referencia no se inicializaba nunca.
  it('lee el punto de miles como miles', () => {
    expect(valorSinIvaDeFactura([fila('$ 98.500.000')])).toBe(98500000)
    expect(valorSinIvaDeFactura([fila('350.906')])).toBe(350906)
    expect(valorSinIvaDeFactura([fila('98.500.000,00')])).toBe(98500000)
  })

  it('el valor limpio que deja el extractor entra igual', () => {
    expect(valorSinIvaDeFactura([fila('98500000')])).toBe(98500000)
    expect(valorSinIvaDeFactura([fila(98500000)])).toBe(98500000)
  })

  // Un negocio arrastra copias heredadas del bloque, y no todas traen el valor.
  it('gana la primera fila con un monto positivo', () => {
    expect(
      valorSinIvaDeFactura([fila(''), fila(null), fila('0'), fila('$ 120.000.000'), fila('5.000')]),
    ).toBe(120000000)
  })

  it('sin un monto legible devuelve 0, el contrato de los dos llamadores', () => {
    expect(valorSinIvaDeFactura([])).toBe(0)
    expect(valorSinIvaDeFactura([{ data: null }])).toBe(0)
    expect(valorSinIvaDeFactura([fila('pendiente')])).toBe(0)
    expect(valorSinIvaDeFactura([fila('-98.500.000')])).toBe(0)
  })

  it('respeta el campo que declara la configuración', () => {
    const filas = [fila('$ 60.000.000', 'valor_base')]
    expect(valorSinIvaDeFactura(filas)).toBe(0)
    expect(valorSinIvaDeFactura(filas, 'valor_base')).toBe(60000000)
  })
})
