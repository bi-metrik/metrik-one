import { describe, it, expect } from 'vitest'

import { causaDePerdida, medirSalida, mensajeDeSalida, pctTexto, type SujetoDeSalida } from './piso-salida'
import type { ContextoCotizacion, FilaItinerario, ItemDeCotizacion } from './itinerarios-datos'

function item(id: string, costo: number, precio: number, extra: Partial<ItemDeCotizacion> = {}): ItemDeCotizacion {
  return {
    id, nombre: id.toUpperCase(), grupo: null, opcion_de: null, es_ajuste: false, orden: 0,
    cantidad: 1, subtotal: costo, numeroDeRubros: 0, costoDeRubros: 0, descuento_porcentaje: 0,
    margen_porcentaje: null, precio_venta: precio, precio_manual: true, adicionales: [],
    ...extra,
  } as ItemDeCotizacion
}

function ctx(items: ItemDeCotizacion[]): ContextoCotizacion {
  return {
    items,
    params: { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' },
    umbrales: { pisoPct: 5, avisoPct: 10 },
    negocioId: 'neg', oportunidadId: null, pisoEnLaSalida: true,
  }
}

function tarifa(id: string, nombre: string, orden: number, seleccion: string[], va = true): FilaItinerario {
  return {
    id, cotizacionId: 'cot', nombre, orden, vaEnPropuesta: va, esPrincipal: false, seleccion,
    motivoCodigo: null, motivoTexto: null, traeColumnasDeMotivo: true,
  }
}

const TRES = [
  item('va', 970, 1000, { grupo: 'vuelo' }),
  item('vb', 880, 1000, { grupo: 'vuelo', opcion_de: 'va' }),
  item('vc', 800, 1000, { grupo: 'vuelo', opcion_de: 'va' }),
]

describe('medirSalida · el conteo de líneas (P1 del ensayo del 2026-09-23)', () => {
  it('una cotización vacía no tiene líneas que medir', () => {
    expect(medirSalida(ctx([]), null).conteo).toEqual({ lineas: 0, sinCosto: 0, faltantes: [] })
  })

  it('cuenta las líneas sin costo ni precio', () => {
    const m = medirSalida(ctx([
      item('a', 0, 0, { precio_manual: false }),
      item('b', 0, 0, { precio_manual: false }),
      item('c', 800, 1000),
    ]), null)
    expect(m.conteo).toMatchObject({ lineas: 3, sinCosto: 2 })
    expect(m.conteo.faltantes.map(f => f.id)).toEqual(['a', 'b'])
  })

  it('el recargo (precio escrito sin costo) NO cuenta como faltante: entra así a propósito', () => {
    const m = medirSalida(ctx([item('p', 700, 1000), item('recargo', 0, 100)]), null)
    expect(m.conteo).toEqual({ lineas: 2, sinCosto: 0, faltantes: [] })
  })

  it('con tarifas marcadas cuenta la unión de sus líneas, una vez cada una', () => {
    const m = medirSalida(ctx(TRES), [tarifa('eco', 'Económica', 1, ['va']), tarifa('rec', 'Recomendada', 2, ['vb'])])
    expect(m.conteo.lineas).toBe(2)
  })

  it('el conteo no entra en la huella: no mueve un peso', () => {
    const vacia = medirSalida(ctx([item('p', 800, 1000)]), null)
    const conFaltante = medirSalida(ctx([item('p', 800, 1000)]), null)
    expect(vacia.firma).toBe(conFaltante.firma)
    expect(vacia.firma).not.toContain('sinCosto')
  })
})

describe('medirSalida · la regla única', () => {
  it('sin tarifas marcadas mide la cotización entera', () => {
    const m = medirSalida(ctx([item('p', 970, 1000)]), null)
    expect(m.sujetos).toHaveLength(1)
    expect(m.sujetos[0].tipo).toBe('cotizacion')
    expect(m.sujetos[0].margenRealPct).toBeCloseTo(3)
    expect(m.bajoPiso).toHaveLength(1)
  })

  it('con tarifas marcadas, CADA una tiene que llegar al piso', () => {
    const m = medirSalida(ctx(TRES), [
      tarifa('eco', 'Económica', 1, ['va']),
      tarifa('rec', 'Recomendada', 2, ['vb']),
      tarifa('pre', 'Premium', 3, ['vc']),
    ])
    expect(m.sujetos.map(s => s.nombre)).toEqual(['Económica', 'Recomendada', 'Premium'])
    expect(m.bajoPiso.map(s => s.nombre)).toEqual(['Económica'])
  })

  it('una tarifa NO marcada no cuenta: no es lo que el cliente ve', () => {
    const m = medirSalida(ctx(TRES), [
      tarifa('eco', 'Económica', 1, ['va'], false),
      tarifa('rec', 'Recomendada', 2, ['vb']),
    ])
    expect(m.bajoPiso).toEqual([])
  })

  it('justo en el piso pasa', () => {
    expect(medirSalida(ctx([item('p', 950, 1000)]), null).bajoPiso).toEqual([])
  })

  it('sin costo cargado no hay margen, y cuenta como bajo el piso', () => {
    const m = medirSalida(ctx([item('p', 0, 1000)]), null)
    expect(m.sujetos[0].margenRealPct).toBeNull()
    expect(m.bajoPiso).toHaveLength(1)
  })

  it('una línea sin costo dentro de una cotización con costo no la vuelve inmedible', () => {
    const m = medirSalida(ctx([item('p', 700, 1000), item('recargo', 0, 100)]), null)
    expect(m.sujetos[0].margenRealPct).not.toBeNull()
    expect(m.bajoPiso).toEqual([])
  })
})

describe('la huella', () => {
  const base = () => medirSalida(ctx(TRES.map(i => ({ ...i }))), [tarifa('eco', 'Económica', 1, ['va'])])

  it('es estable: el mismo estado da la misma firma', () => {
    expect(base().firma).toBe(base().firma)
  })

  it('cambia con cualquier precio, costo o margen, incluso de una alternativa que no sale', () => {
    const items = TRES.map(i => ({ ...i }))
    items[2].subtotal = 801
    const otra = medirSalida(ctx(items), [tarifa('eco', 'Económica', 1, ['va'])])
    expect(otra.firma).not.toBe(base().firma)
  })

  it('NO cambia al renombrar una tarifa o una línea', () => {
    const items = TRES.map(i => ({ ...i, nombre: `${i.nombre} renombrado` }))
    const otra = medirSalida(ctx(items), [tarifa('eco', 'Básica', 1, ['va'])])
    expect(otra.firma).toBe(base().firma)
  })
})

describe('mensajeDeSalida · en lenguaje de operadora', () => {
  const s = (extra: Partial<SujetoDeSalida>): SujetoDeSalida => ({
    tipo: 'tarifa', id: 'x', nombre: 'Económica', total: 1000, margenRealPct: 3, ranurasFaltantes: [], bajoPiso: true, ...extra,
  })

  it('nombra la tarifa, su margen y el mínimo, y dice a quién pedírselo', () => {
    expect(mensajeDeSalida([s({})], 5, 'Edgar')).toBe(
      'La tarifa Económica deja un margen de 3 %, por debajo del mínimo de 5 %. Pídele a Edgar que la autorice o ajusta el precio.',
    )
  })

  it('sin un dueño único no nombra a nadie', () => {
    expect(mensajeDeSalida([s({})], 5, null)).toContain('Pídele al dueño del workspace')
  })

  it('en plural cuando son varias', () => {
    const m = mensajeDeSalida([s({}), s({ nombre: 'Premium', margenRealPct: 4 })], 5, 'Edgar')
    expect(m).toContain('La tarifa Premium deja un margen de 4 %')
    expect(m).toContain('que las autorice o ajusta los precios.')
  })

  it('dice cuándo el margen no se puede medir', () => {
    expect(mensajeDeSalida([s({ tipo: 'cotizacion', margenRealPct: null })], 5, 'Edgar')).toContain(
      'La cotización no tiene un margen que se pueda medir',
    )
  })
})

describe('pctTexto', () => {
  it('escribe el porcentaje en español', () => {
    expect(pctTexto(3)).toBe('3 %')
    expect(pctTexto(4.94)).toBe('4,9 %')
  })

  it('bajo el piso trunca en vez de redondear hasta el piso', () => {
    // 4,96 redondeado es «5,0 %», que se leería «deja 5 %, por debajo del mínimo de 5 %».
    expect(pctTexto(4.96, 5)).toBe('4,9 %')
  })
})

describe('causaDePerdida · qué cambió', () => {
  const antes = medirSalida(ctx(TRES.map(i => ({ ...i }))), [tarifa('eco', 'Económica', 1, ['va'])]).detalle

  it('nombra la tarifa que cambió de precio', () => {
    const items = TRES.map(i => ({ ...i }))
    items[0].precio_venta = 990
    const hoy = medirSalida(ctx(items), [tarifa('eco', 'Económica', 1, ['va'])]).detalle
    expect(causaDePerdida(antes, hoy)).toMatch(/^La tarifa Económica pasó de 3 % \(\$1\.000\) a 2 % \(\$990\)\.$/)
  })

  it('nombra la línea cuando lo que cambió no toca las tarifas que salen', () => {
    const items = TRES.map(i => ({ ...i }))
    items[2].subtotal = 810
    const hoy = medirSalida(ctx(items), [tarifa('eco', 'Económica', 1, ['va'])]).detalle
    expect(causaDePerdida(antes, hoy)).toBe('Cambió el precio, el costo o el margen de la línea «VC».')
  })

  it('una tarifa que sale de la propuesta', () => {
    const hoy = medirSalida(ctx(TRES.map(i => ({ ...i }))), [tarifa('rec', 'Recomendada', 2, ['vb'])]).detalle
    expect(causaDePerdida(antes, hoy)).toBe('La tarifa Económica ya no está en la propuesta.')
  })
})

describe('medirSalida · la línea sin costo que entra al total que sale (Mauricio, 2026-09-23)', () => {
  const VUELO3 = 'vuelo 3: Vuelo a Providencia'
  const COT11 = [
    item('avianca', 2_184_600, 2_570_118, { grupo: 'vuelo' }),
    item('op1', 0, 0, { grupo: VUELO3, nombre: 'OPCIÓN 1', precio_manual: false }),
    item('op2', 0, 0, { grupo: VUELO3, nombre: 'OPCIÓN 2', precio_manual: false }),
  ]

  it('sin tarifas: la opción vacía que suma hoy es un faltante, con su nombre y su ranura', () => {
    const { faltantes } = medirSalida(ctx(COT11), null).conteo
    expect(faltantes).toHaveLength(1)
    expect(faltantes[0]).toMatchObject({ grupo: VUELO3 })
    expect(['OPCIÓN 1', 'OPCIÓN 2']).toContain(faltantes[0].nombre)
  })

  it('con tarifas: solo cuenta si una tarifa MARCADA la lleva', () => {
    const fuera = medirSalida(ctx(COT11), [tarifa('t1', 'Recomendada', 1, ['avianca']), tarifa('t2', 'Borrador', 2, ['avianca', 'op1'], false)])
    expect(fuera.conteo.faltantes).toEqual([])
    const dentro = medirSalida(ctx(COT11), [tarifa('t1', 'Recomendada', 1, ['avianca', 'op2'])])
    expect(dentro.conteo.faltantes.map(f => f.id)).toEqual(['op2'])
  })
})
