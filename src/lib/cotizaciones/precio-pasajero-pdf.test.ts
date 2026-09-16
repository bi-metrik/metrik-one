import { describe, expect, it } from 'vitest'

import { precioPorPasajeroDeItem, preciosPorPasajeroDelViaje } from './precio-pasajero-pdf'
import { viajeDesdeFilas } from './viaje-negocio'

const confirmadaLatam = {
  composicion: { adultos: 5, ninos: 1, infantes: 0 },
  costos: [
    { tipo: 'adulto', cantidad: 5, unitarioCOP: 1907063, totalCOP: 9535315 },
    { tipo: 'nino', cantidad: 1, unitarioCOP: 1771063, totalCOP: 1771063 },
  ],
  costoTotalCOP: 11306378,
  moneda: 'COP',
  tasa: null,
  confirmadaEn: '2026-09-16T12:00:00Z',
}

const rubrosLatam = [
  { valor_total: 9535315, sugerido: false },
  { valor_total: 1771063, sugerido: false },
]

describe('precio por pasajero de una línea', () => {
  it('reparte el precio de venta de la línea entre adultos y niños', () => {
    const p = precioPorPasajeroDeItem({ precio_venta: 13301621, tarifa_pax: { confirmada: confirmadaLatam }, rubros: rubrosLatam })
    expect(p?.map(x => x.tipo)).toEqual(['adulto', 'nino'])
    const suma = (p ?? []).reduce((a, x) => a + x.precioUnitario * x.cantidad, 0)
    expect(Math.abs(suma - 13301621)).toBeLessThanOrEqual(3)
  })

  it('una línea sin tarifa por pasajero se cobra por el grupo: null', () => {
    expect(precioPorPasajeroDeItem({ precio_venta: 100, tarifa_pax: null, rubros: [] })).toBeNull()
    expect(precioPorPasajeroDeItem({ precio_venta: 100, rubros: [] })).toBeNull()
  })

  it('si alguien cambió los rubros después de confirmar, NO se imprime el reparto viejo', () => {
    const editados = [...rubrosLatam, { valor_total: 500000, sugerido: false }]
    expect(precioPorPasajeroDeItem({ precio_venta: 13301621, tarifa_pax: { confirmada: confirmadaLatam }, rubros: editados })).toBeNull()
  })

  it('un rubro SUGERIDO no cuenta como costo de la línea', () => {
    const conSugerido = [...rubrosLatam, { valor_total: 500000, sugerido: true }]
    expect(precioPorPasajeroDeItem({ precio_venta: 13301621, tarifa_pax: { confirmada: confirmadaLatam }, rubros: conSugerido })).not.toBeNull()
  })
})

describe('precio por pasajero del viaje', () => {
  it('suma por tipo el precio de cada componente que lo incluye, y nombra lo que va por grupo', () => {
    const r = preciosPorPasajeroDelViaje([
      { nombre: 'Vuelo', precio_venta: 3000, cantidad: 1, precioPorPasajero: [{ tipo: 'adulto', cantidad: 2, precioUnitario: 1000 }, { tipo: 'nino', cantidad: 1, precioUnitario: 1000 }] },
      { nombre: 'Hotel', precio_venta: 2500, cantidad: 1, precioPorPasajero: [{ tipo: 'adulto', cantidad: 2, precioUnitario: 1000 }, { tipo: 'nino', cantidad: 1, precioUnitario: 500 }] },
      { nombre: 'Seguro', precio_venta: 300, cantidad: 1, precioPorPasajero: null },
    ])
    expect(r).toEqual({
      filas: [{ tipo: 'adulto', precioUnitario: 2000 }, { tipo: 'nino', precioUnitario: 1500 }],
      sinReparto: ['Seguro'],
    })
  })

  it('un tipo que ninguna línea incluye no aparece (no hay «Infante $0»)', () => {
    const r = preciosPorPasajeroDelViaje([
      { nombre: 'Vuelo', precio_venta: 2000, cantidad: 1, precioPorPasajero: [{ tipo: 'adulto', cantidad: 2, precioUnitario: 1000 }] },
    ])
    expect(r?.filas.map(f => f.tipo)).toEqual(['adulto'])
  })

  it('sin ninguna línea con reparto no hay sección (Termotech, Arca, WMC)', () => {
    expect(preciosPorPasajeroDelViaje([{ nombre: 'Bomba', precio_venta: 1000, cantidad: 2 }])).toBeNull()
  })
})

describe('quiénes viajan, desde los bloques del negocio', () => {
  it('toma la primera composición válida y las fechas del viaje', () => {
    const v = viajeDesdeFilas([
      { adultos: null, ninos: null, infantes: null, fecha_salida: null, fecha_regreso: null },
      { adultos: 2, ninos: 1, infantes: 0, fecha_salida: '2026-12-19', fecha_regreso: '2026-12-23' },
    ])
    expect(v).toEqual({ composicion: { adultos: 2, ninos: 1, infantes: 0 }, fechas: { inicio: '2026-12-19', fin: '2026-12-23' } })
  })

  it('sin adultos no hay composición: la línea la pide', () => {
    expect(viajeDesdeFilas([{ adultos: '', ninos: 2 }]).composicion).toBeNull()
  })
})
