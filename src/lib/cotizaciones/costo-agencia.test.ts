/**
 * Qué paga la agencia según la captura: neto escrito, neto derivado, o abstención.
 *
 * Los números NO son inventados: salen del banco real de Trappvel
 * (`proyectos/trappvel/clarity/capturas-proveedor/2026-09-16/`), que es lo único que
 * puede decir si la regla sirve con las pantallas que la agencia pega de verdad.
 *
 * ⚠️ Mutaciones MEDIDAS sobre este archivo (aplicadas y revertidas):
 *   · el neto leído deja de mandar y siempre se deriva de la comisión ... 2 rojas
 *   · la tolerancia pasa a 0 (igualdad exacta) ......................... 1 roja
 *   · la tolerancia pasa a infinita (nunca se abstiene) ................ 1 roja
 *   · con las dos formas de la comisión manda el PORCENTAJE ............ 1 roja
 *   · una comisión mayor que el precio se acepta ....................... 1 roja
 */
import { describe, expect, it } from 'vitest'
import { resolverCostoAgencia, type CostoAgencia, type AbstencionCostoAgencia } from './costo-agencia'

const sinComision = { comisionValor: null, comisionPct: null }

describe('el neto ESCRITO manda', () => {
  it('Decameron: «total a pagar agencia» es el costo', () => {
    const r = resolverCostoAgencia({
      precioCliente: 2_029_118,
      netoLeido: 1_818_919,
      ...sinComision,
    }) as CostoAgencia
    expect(r.costoAgencia).toBe(1_818_919)
    expect(r.origen).toBe('neto_leido')
  })

  it('Ushuaia: «precio neto» es el mismo hecho con otras palabras', () => {
    // Lo que hoy NO se toma: en las 4 corridas del banco este campo volvió vacío y la
    // línea se vendía con el margen general de la cotización.
    const r = resolverCostoAgencia({
      precioCliente: 799_016.38,
      netoLeido: 687_154.09,
      ...sinComision,
    }) as CostoAgencia
    expect(r.costoAgencia).toBe(687_154.09)
    expect(r.origen).toBe('neto_leido')
  })

  it('⚠️ el neto escrito gana AUNQUE la comisión dé otro número', () => {
    // Es el caso Decameron completo, y el que obliga a que las dos vías no se crucen
    // entre sí: 9,23% de 2.029.118 son 187.288, así que la resta daría 1.841.830 y no
    // el 1.818.919 que la pantalla escribe (hallazgo 7.1, faltan conceptos). Exigir
    // que cuadren le quitaría el margen al único caso que hoy funciona.
    const r = resolverCostoAgencia({
      precioCliente: 2_029_118,
      netoLeido: 1_818_919,
      comisionValor: 187_288,
      comisionPct: 9.23,
    }) as CostoAgencia
    expect(r.costoAgencia).toBe(1_818_919)
    expect(r.origen).toBe('neto_leido')
  })
})

describe('sin neto escrito, la comisión lo deriva', () => {
  it('con la comisión en plata', () => {
    const r = resolverCostoAgencia({
      precioCliente: 799_016.38,
      netoLeido: null,
      comisionValor: 111_862.29,
      comisionPct: null,
    }) as CostoAgencia
    expect(r.costoAgencia).toBeCloseTo(687_154.09, 2)
    expect(r.origen).toBe('derivado_comision')
  })

  it('con la comisión solo en porcentaje', () => {
    const r = resolverCostoAgencia({
      precioCliente: 1_000_000,
      netoLeido: null,
      comisionValor: null,
      comisionPct: 10,
    }) as CostoAgencia
    expect(r.costoAgencia).toBe(900_000)
    expect(r.origen).toBe('derivado_comision')
  })

  it('con las dos escritas y coincidentes manda la de PLATA, no el porcentaje', () => {
    // El porcentaje viene redondeado en pantalla: usarlo arrastraría ese redondeo al
    // costo. Aquí «14%» de 799.016,38 da 111.862,2932 y la pantalla dice 111.862,29.
    const r = resolverCostoAgencia({
      precioCliente: 799_016.38,
      netoLeido: null,
      comisionValor: 111_862.29,
      comisionPct: 14,
    }) as CostoAgencia
    expect(r.costoAgencia).toBe(799_016.38 - 111_862.29)
    expect(r.comision).toBe(111_862.29)
  })
})

describe('cuando la captura se contradice, no se fija margen y se dice por qué', () => {
  it('el porcentaje y la plata no son la misma comisión', () => {
    const r = resolverCostoAgencia({
      precioCliente: 799_016.38,
      netoLeido: null,
      comisionValor: 50_000,
      comisionPct: 14,
    }) as AbstencionCostoAgencia
    expect(r.costoAgencia).toBeNull()
    expect(r.motivo).toContain('No coinciden')
    // El motivo tiene que traer los dos números, o no sirve para decidir cuál revisar.
    expect(r.motivo).toContain('50.000')
    expect(r.motivo).toContain('14%')
  })

  it('una comisión que se come el precio entero es una lectura cruzada', () => {
    const r = resolverCostoAgencia({
      precioCliente: 100_000,
      netoLeido: null,
      comisionValor: 100_000,
      comisionPct: null,
    }) as AbstencionCostoAgencia
    expect(r.costoAgencia).toBeNull()
    expect(r.motivo).toContain('no es menor que el precio')
  })

  it('el redondeo del porcentaje impreso NO se lee como contradicción', () => {
    // «14%» sobre 799.016,38 da 111.862,2932; la pantalla escribe 111.862,29. Con
    // igualdad exacta esta captura correcta se quedaría sin margen.
    const r = resolverCostoAgencia({
      precioCliente: 799_016.38,
      netoLeido: null,
      comisionValor: 111_862.29,
      comisionPct: 14,
    })
    expect(r?.costoAgencia).not.toBeNull()
  })
})

describe('la respuesta normal es que no hay nada que resolver', () => {
  it('un buscador que muestra UN precio', () => {
    expect(resolverCostoAgencia({ precioCliente: 1_000_000, netoLeido: null, ...sinComision })).toBeNull()
  })

  it('un neto en cero o negativo no es un neto', () => {
    expect(resolverCostoAgencia({ precioCliente: 1_000_000, netoLeido: 0, ...sinComision })).toBeNull()
  })

  it('sin precio no se puede derivar nada', () => {
    expect(resolverCostoAgencia({
      precioCliente: 0,
      netoLeido: null,
      comisionValor: 10_000,
      comisionPct: null,
    })).toBeNull()
  })
})
