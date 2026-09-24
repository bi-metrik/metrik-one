import { describe, expect, it } from 'vitest'

import { precioPorHabitacionDeItem, precioPorPasajeroDeItem, preciosPorPasajeroDelViaje } from './precio-pasajero-pdf'
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
      filas: [
        { tipo: 'adulto', cantidad: 2, precioUnitario: 2000 },
        { tipo: 'nino', cantidad: 1, precioUnitario: 1500 },
      ],
      // 2 adultos a 2000 + 1 nino a 1500. Es lo que la tabla del PDF explica; el resto
      // (el Seguro) se nombra y su plata sale de restar contra el total impreso.
      cubierto: 5500,
      sinReparto: ['Seguro'],
    })
  })

  it('⚠️ los ADICIONALES de una linea repartida tambien quedan fuera de la suma', () => {
    // `precioPorPasajeroDeItem` reparte `items.precio_venta`, que es el precio BASE de la
    // variante: la maleta extra vive en `valorAdicionales` y NO esta en el reparto. Es el
    // hueco exacto que dejo la prueba real de Providencia con 360.000 sin explicar.
    const r = preciosPorPasajeroDelViaje([
      {
        nombre: 'Vuelo',
        precio_venta: 3000,
        cantidad: 1,
        adicionales: ['Equipaje de bodega adicional x2'],
        precioPorPasajero: [{ tipo: 'adulto', cantidad: 2, precioUnitario: 1000 }],
      },
    ])
    expect(r?.cubierto).toBe(2000)
    expect(r?.sinReparto).toEqual(['Equipaje de bodega adicional x2'])
  })

  it('⚠️ si las lineas NO coinciden en cuantos viajan, no se multiplica ni se reconcilia', () => {
    // Un vuelo para 6 adultos y un hotel para 4: multiplicar por cualquiera de los dos
    // daria un subtotal que no es el de nadie. `cubierto` en null hace que el documento
    // lo diga en vez de imprimir dos cifras que no cierran.
    const r = preciosPorPasajeroDelViaje([
      { nombre: 'Vuelo', precio_venta: 6000, cantidad: 1, precioPorPasajero: [{ tipo: 'adulto', cantidad: 6, precioUnitario: 1000 }] },
      { nombre: 'Hotel', precio_venta: 2000, cantidad: 1, precioPorPasajero: [{ tipo: 'adulto', cantidad: 4, precioUnitario: 500 }] },
    ])
    expect(r?.filas).toEqual([{ tipo: 'adulto', cantidad: null, precioUnitario: 1500 }])
    expect(r?.cubierto).toBeNull()
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
    expect(v.composicion).toEqual({ adultos: 2, ninos: 1, infantes: 0 })
    expect(v.fechas).toEqual({ inicio: '2026-12-19', fin: '2026-12-23' })
  })

  it('lo que alimenta la portada del documento del cliente sale de los mismos bloques', () => {
    const v = viajeDesdeFilas([
      { destino: 'Cancún', presentacion_destino: 'Playa turquesa y zona maya.', nivel_detalle: 'muy_detallada' },
    ])
    expect(v.destino).toBe('Cancún')
    expect(v.presentacion).toBe('Playa turquesa y zona maya.')
    expect(v.nivelDetalle).toBe('muy_detallada')
  })

  it('un negocio que no declara nada de eso no inventa: destino y párrafo vacíos, detalle normal', () => {
    const v = viajeDesdeFilas([{ adultos: 2 }])
    expect(v.destino).toBeNull()
    expect(v.presentacion).toBeNull()
    expect(v.nivelDetalle).toBe('normal')
  })

  it('sin adultos no hay composición: la línea la pide', () => {
    expect(viajeDesdeFilas([{ adultos: '', ninos: 2 }]).composicion).toBeNull()
  })
})

describe('R8 · regla 8: una opción de hotel cobrada por habitación', () => {
  // Posada Enilda (COT-2026-0013): sin una de solo adultos del mismo tipo para restar.
  const porHabitacion = [
    { numero: 1, ocupacion: { adultos: 2, ninos: 0, infantes: 0 }, totalCOP: 403718.34 },
    { numero: 2, ocupacion: { adultos: 2, ninos: 0, infantes: 1 }, totalCOP: 412689.86 },
    { numero: 3, ocupacion: { adultos: 2, ninos: 1, infantes: 0 }, totalCOP: 412689.86 },
  ]
  const confirmada = {
    composicion: { adultos: 6, ninos: 1, infantes: 1 },
    costos: [],
    costoTotalCOP: 1229098.06,
    moneda: 'COP',
    tasa: null,
    confirmadaEn: '2026-09-24T12:00:00Z',
    porHabitacion,
  }
  const rubros = porHabitacion.map(h => ({ valor_total: h.totalCOP, sugerido: false }))
  const item = { precio_venta: 1_450_000, tarifa_pax: { composicion: confirmada.composicion, confirmada }, rubros }

  it('imprime el precio de cada habitación, y suma el precio de la línea', () => {
    const p = precioPorHabitacionDeItem(item)
    expect(p?.map(h => h.numero)).toEqual([1, 2, 3])
    expect(p?.map(h => h.ocupacionTexto)).toEqual(['2 adultos', '2 adultos y 1 infante', '2 adultos y 1 niño'])
    expect((p ?? []).reduce((a, h) => a + h.precio, 0)).toBe(1_450_000)
    // El precio por pasajero no se inventa: la línea no tiene reparto por tipo.
    expect(precioPorPasajeroDeItem(item)).toEqual([])
  })

  it('con rubros editados después de confirmar, no se imprime', () => {
    expect(precioPorHabitacionDeItem({ ...item, rubros: [...rubros, { valor_total: 1000, sugerido: false }] })).toBeNull()
  })

  it('una línea con precio por pasajero no trae precio por habitación', () => {
    expect(precioPorHabitacionDeItem({ precio_venta: 13301621, tarifa_pax: { confirmada: confirmadaLatam }, rubros: rubrosLatam })).toBeNull()
  })
})
