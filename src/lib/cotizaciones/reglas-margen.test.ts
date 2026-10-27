import { describe, expect, it } from 'vitest'

import { calcularCascada, type ItemParaCascada, type ParametrosCascada } from './totales'
import { margenMedible, motivoDeRechazo, textoDeRechazo } from './itinerarios'
import {
  POLITICA_REGLAS_POR_DEFECTO,
  colchonDeLinea,
  colchonDeTiquete,
  comisionDePublica,
  leerReglasDeCotizacion,
  motivoReglasInvalidas,
  paramsPorOpcion,
  pctDescuentoTotal,
  politicaReglasDeLinea,
  reglasAJsonb,
  reglasAlNacer,
  tipoParaMargen,
  type ReglasDeCotizacion,
} from './reglas-margen'
import { leerTarifaPax } from './tarifa-pasajero'

/**
 * Las reglas de margen del brief del 2026-10-27 (Trappvel), con datos FICTICIOS. Cada caso del
 * brief tiene su prueba con el número que el brief pide.
 */

const P = POLITICA_REGLAS_POR_DEFECTO
const reglas = (r: Partial<ReglasDeCotizacion> = {}): ReglasDeCotizacion => ({ politica: P, puntosExtra: 0, descuentos: [], ...r })
const params = (r: Partial<ReglasDeCotizacion> | null = {}, margenPct = 15): ParametrosCascada => ({
  administrativosPct: 0,
  margenPct,
  descuentoComercialPct: 0,
  convencionMargen: 'sobre_venta',
  reglas: r === null ? null : reglas(r),
})

/** Una lectura de pantallazo con la ruta del vuelo, como la deja `tarifa_pax`. */
const ruta = (origen: string, destino: string) => ({
  casillas: { grupo_completo: { moneda: 'COP', total: 1, campos: [{ label: 'Origen', valor: origen }, { label: 'Destino', valor: destino }] } },
})

const linea = (x: Partial<ItemParaCascada> & { id: string }): ItemParaCascada => ({
  cantidad: 1,
  numeroDeRubros: 0,
  margen_porcentaje: null,
  precio_venta: 0,
  precio_manual: false,
  ...x,
})

const vuelo = (id: string, costo: number, origen = 'BOG', destino = 'ADZ', extra: Partial<ItemParaCascada> = {}) =>
  linea({ id, grupo: 'vuelo', nombre: 'Vuelo ficticio', subtotal: costo, tarifa_pax: ruta(origen, destino), ...extra })
const hotel = (id: string, costo: number, extra: Partial<ItemParaCascada> = {}) =>
  linea({ id, grupo: 'hotel', nombre: 'Hotel Ficticio Playa', subtotal: costo, ...extra })
const plan = (id: string, costo: number, extra: Partial<ItemParaCascada> = {}) =>
  linea({ id, grupo: 'actividad', nombre: 'Paseo ficticio en lancha', subtotal: costo, ...extra })

const de = (c: ReturnType<typeof calcularCascada>, id: string) => c.lineas.find(l => l.id === id)!

describe('1 · el colchón del vuelo: proporcional, con piso y techo', () => {
  it('los cuatro casos del brief', () => {
    expect(colchonDeTiquete(200_000, P.colchonVuelo.nacional)).toBe(30_000) // piso
    expect(colchonDeTiquete(600_000, P.colchonVuelo.nacional)).toBe(60_000)
    expect(colchonDeTiquete(1_500_000, P.colchonVuelo.internacional)).toBe(75_000)
    expect(colchonDeTiquete(10_000_000, P.colchonVuelo.internacional)).toBe(200_000) // techo, no $500.000
  })

  it('nacional o internacional sale de la ruta; lo que no se reconoce cuenta como internacional', () => {
    expect(colchonDeLinea(vuelo('v', 600_000, 'BOG', 'ADZ'), 600_000, 1, P)).toMatchObject({ colchon: 60_000, internacional: false, tiquetes: 1 })
    expect(colchonDeLinea(vuelo('v', 1_500_000, 'BOG', 'MAD'), 1_500_000, 1, P)).toMatchObject({ colchon: 75_000, internacional: true })
    const dudoso = colchonDeLinea(vuelo('v', 1_500_000, 'BOG', 'XQZ'), 1_500_000, 1, P)
    expect(dudoso.internacional).toBe(true)
    expect(dudoso.sinReconocer).toEqual(['XQZ'])
  })

  it('va por pasajero y por tiquete: dos adultos de 300.000 llevan 30.000 cada uno', () => {
    const v = vuelo('v', 600_000, 'BOG', 'ADZ', { pasajeros: [{ cantidad: 2, peso: 600_000 }] })
    expect(colchonDeLinea(v, 600_000, 1, P)).toMatchObject({ colchon: 60_000, tiquetes: 2, porTiquete: [30_000, 30_000] })
  })

  it('en la cascada: precio = costo + colchón, el colchón se ve como el margen de la línea, y se puede editar', () => {
    const c = calcularCascada([vuelo('v', 600_000)], params())
    const l = de(c, 'v')
    expect(l.precioLinea).toBe(660_000)
    expect(l.margenAplicado).toBeCloseTo((60_000 / 660_000) * 100, 6)
    expect(l.reglas?.colchon?.colchon).toBe(60_000)
    // Un margen escrito a mano manda sobre el colchón.
    const editado = de(calcularCascada([vuelo('v', 600_000, 'BOG', 'ADZ', { margen_porcentaje: 20 })], params()), 'v')
    expect(editado.precioLinea).toBe(750_000)
    expect(editado.reglas?.colchon).toBeNull()
  })

  it('un tiquete internacional de $10 M lleva $200.000, no $500.000', () => {
    expect(de(calcularCascada([vuelo('v', 10_000_000, 'BOG', 'MAD')], params()), 'v').precioLinea).toBe(10_200_000)
  })
})

describe('2 · hotel al 15 % editable, con descuento que ve el cliente', () => {
  it('15 % con un descuento de 3 queda en 12 %: no pide aprobación', () => {
    const h = hotel('h', 850_000, { tarifa_pax: { descuentoCliente: { motivo: 'Cierre esta semana', tipo: 'pct', valor: 3 } } })
    const c = calcularCascada([h], params())
    const l = de(c, 'h')
    expect(l.margenRealPct).toBeCloseTo(12, 3) // al peso
    expect(l.reglas?.descuento).toMatchObject({ motivo: 'Cierre esta semana', precioSinDescuento: 1_000_000 })
    expect(l.reglas?.descuento?.valor).toBe(1_000_000 - l.precioLinea)
    expect(c.reglas?.hotelesBajoPiso).toEqual([])
  })

  it('15 % con un descuento de 7 queda en 8 %: pide aprobación', () => {
    const h = hotel('h', 850_000, { tarifa_pax: { descuentoCliente: { motivo: 'Cliente frecuente', tipo: 'pct', valor: 7 } } })
    const c = calcularCascada([h], params())
    expect(de(c, 'h').margenRealPct).toBeCloseTo(8, 3)
    expect(c.reglas?.hotelesBajoPiso).toEqual([{ id: 'h', margenPct: expect.closeTo(8, 3) }])
    const motivo = motivoDeRechazo({
      ranurasFaltantes: [],
      margenRealPct: margenMedible(c),
      pisoPct: 5,
      hotelesBajoPiso: [{ nombre: 'Hotel Ficticio Playa', margenPct: 8 }],
      pisoHotelPct: 10,
    })
    expect(motivo?.tipo).toBe('hotel_bajo_piso')
    expect(textoDeRechazo(motivo!)).toMatch(/Hotel Ficticio Playa \(8,0%\).*margen mínimo de hotel de 10,0%/)
  })

  it('un descuento en pesos baja el precio en esos pesos', () => {
    const h = hotel('h', 850_000, { tarifa_pax: { descuentoCliente: { motivo: 'Temporada baja', tipo: 'monto', valor: 50_000 } } })
    const l = de(calcularCascada([h], params()), 'h')
    expect(l.precioLinea).toBe(950_000)
    expect(l.reglas?.descuento?.valor).toBe(50_000)
  })

  it('funciona en las tres opciones: cada hotel lleva su descuento', () => {
    const hs = [
      hotel('eco', 425_000, { tarifa_pax: { descuentoCliente: { motivo: 'A', tipo: 'pct', valor: 2 } } }),
      hotel('rec', 850_000),
      hotel('pre', 1_700_000, { tarifa_pax: { descuentoCliente: { motivo: 'C', tipo: 'monto', valor: 100_000 } } }),
    ]
    const c = calcularCascada(hs, params())
    expect(de(c, 'eco').margenRealPct).toBeCloseTo(13, 4)
    expect(de(c, 'rec').reglas?.descuento).toBeNull()
    expect(de(c, 'pre').reglas?.descuento?.valor).toBe(100_000)
  })

  it('el descuento se guarda y se vuelve a leer en `tarifa_pax` (no se pierde en la próxima escritura)', () => {
    const t = leerTarifaPax({ descuentoCliente: { motivo: 'Cierre', tipo: 'pct', valor: 3, por: 'Asesora', en: '2026-10-27' } })
    expect(t.descuentoCliente).toMatchObject({ motivo: 'Cierre', tipo: 'pct', valor: 3 })
    expect(leerTarifaPax({}).descuentoCliente).toBeUndefined()
  })
})

describe('3 · planes, actividades, traslados y lo demás arrancan en 0 %', () => {
  it('una línea nueva de plan o actividad nace en 0 %', () => {
    const c = calcularCascada([plan('p', 300_000), linea({ id: 't', grupo: 'traslado', subtotal: 100_000 })], params())
    expect(de(c, 'p').margenAplicado).toBe(0)
    expect(de(c, 'p').precioLinea).toBe(300_000)
    expect(de(c, 't').margenAplicado).toBe(0)
  })

  it('el usuario lo sube a mano', () => {
    expect(de(calcularCascada([plan('p', 300_000, { margen_porcentaje: 10 })], params()), 'p').precioLinea).toBe(333_333)
  })

  it('una Pública sigue en 0 sin aprobación', () => {
    const pub = plan('pub', 200_000, { tarifa_pax: { tipoTarifa: { tipo: 'publica', origen: 'persona', por: null, en: '' } } })
    const c = calcularCascada([pub], params())
    expect(de(c, 'pub').precioLinea).toBe(200_000)
    expect(c.publicas.exentaDelMinimo).toBe(true)
    expect(margenMedible(c)).toBeNull()
  })

  it('sin reglas todo hereda el margen de la cotización, como antes', () => {
    const c = calcularCascada([plan('p', 850_000)], params(null))
    expect(de(c, 'p').precioLinea).toBe(1_000_000)
    expect(c.reglas).toBeUndefined()
  })
})

describe('4 · puntos extra: hoteles y planes, nunca vuelos, y las líneas cuadran con el total al peso', () => {
  const items = [vuelo('v', 600_000), hotel('h', 850_000), plan('p', 300_000), plan('p2', 123_457)]

  it('5 puntos suben el margen global 5 puntos y el vuelo no recibe nada', () => {
    const sin = calcularCascada(items, params())
    const con = calcularCascada(items, params({ puntosExtra: 5 }))
    expect(de(con, 'v').precioConAdicionales).toBe(de(sin, 'v').precioConAdicionales)
    expect(de(con, 'v').reglas?.puntos).toBe(0)
    expect(de(con, 'h').reglas!.puntos).toBeGreaterThan(0)
    expect(de(con, 'p').reglas!.puntos).toBeGreaterThan(0)
    // En proporción al precio: el hotel (1.000.000) recibe más que el plan (300.000).
    expect(de(con, 'h').reglas!.puntos / de(con, 'p').reglas!.puntos).toBeCloseTo(1_000_000 / 300_000, 1)
    expect(con.reglas!.margenGlobalPct!).toBeCloseTo(sin.reglas!.margenGlobalPct! + 5, 2)
  })

  it('la suma de las líneas es el total, al peso', () => {
    const con = calcularCascada(items, params({ puntosExtra: 5 }))
    const suma = con.lineas.reduce((a, l) => a + l.precioConAdicionales, 0)
    expect(suma).toBe(con.ventaBruta)
    expect(con.ventaBruta).toBe(con.precioVenta)
    expect(con.reglas!.subtotal).toBe(suma)
    expect(Number.isInteger(suma)).toBe(true)
  })

  it('con pasajeros, cada línea queda cuadrada por pasajero', () => {
    const conPax = [hotel('h', 850_000, { pasajeros: [{ cantidad: 3, peso: 850_000 }] }), plan('p', 300_000, { pasajeros: [{ cantidad: 3, peso: 300_000 }] })]
    const con = calcularCascada(conPax, params({ puntosExtra: 3 }))
    for (const l of con.lineas) expect(l.precioConAdicionales % 3).toBe(0)
    expect(con.lineas.reduce((a, l) => a + l.precioConAdicionales, 0)).toBe(con.precioVenta)
  })

  it('no salen como renglón aparte ni cambian el precio base de la línea (lo que se guarda)', () => {
    const con = calcularCascada(items, params({ puntosExtra: 5 }))
    const sin = calcularCascada(items, params())
    expect(de(con, 'h').precioLinea).toBe(de(sin, 'h').precioLinea)
    expect(con.lineas).toHaveLength(items.length)
  })

  it('los precios de cada opción por separado van sin puntos', () => {
    const con = calcularCascada(items, paramsPorOpcion(params({ puntosExtra: 5, descuentos: [{ id: 'a', descripcion: 'X', pct: 5 }] })))
    expect(con.reglas!.puntosPesos).toBe(0)
    expect(con.reglas!.descuentos).toEqual([])
  })
})

describe('5 · descuentos sobre el total: uno o varios, con descripción, después de los puntos', () => {
  it('dos descuentos salen con su descripción y el margen global los descuenta', () => {
    const items = [hotel('h', 850_000), plan('p', 300_000)]
    const sin = calcularCascada(items, params({ puntosExtra: 2 }))
    const con = calcularCascada(items, params({
      puntosExtra: 2,
      descuentos: [
        { id: 'a', descripcion: 'Alianza fondo de empleados X', pct: 5 },
        { id: 'b', descripcion: 'Cliente recurrente', pct: 10 },
      ],
    }))
    expect(con.ventaBruta).toBe(sin.ventaBruta)
    expect(con.reglas!.descuentos.map(d => [d.descripcion, d.valor])).toEqual([
      ['Alianza fondo de empleados X', Math.round(sin.ventaBruta * 0.05)],
      ['Cliente recurrente', Math.round(sin.ventaBruta * 0.10)],
    ])
    expect(con.precioVenta).toBe(con.reglas!.subtotal - con.reglas!.descuentos.reduce((a, d) => a + d.valor, 0))
    const costo = 850_000 + 300_000
    expect(con.reglas!.margenGlobalPct!).toBeCloseTo(((con.precioVenta - costo) / con.precioVenta) * 100, 6)
    expect(con.reglas!.margenGlobalPct!).toBeLessThan(sin.reglas!.margenGlobalPct!)
  })

  it('el descuento comercial de siempre, si lo hay, sale como uno más con su nombre', () => {
    const c = calcularCascada([hotel('h', 850_000)], { ...params(), descuentoComercialPct: 2 })
    expect(c.reglas!.descuentos.map(d => d.descripcion)).toEqual(['Descuento comercial'])
    expect(pctDescuentoTotal({ descuentoComercialPct: 2, reglas: reglas({ descuentos: [{ id: 'a', descripcion: 'X', pct: 5 }] }) })).toBe(7)
  })
})

describe('6 · margen global: calculado, con piso de aprobación de 12 %', () => {
  const juzgar = (c: ReturnType<typeof calcularCascada>) => motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: margenMedible(c), pisoPct: 12 })

  it('con 11,9 % pide aprobación; con 12 % no', () => {
    const bajo = calcularCascada([hotel('h', 881_000)], params({}, 11.9))
    const justo = calcularCascada([hotel('h', 880_000)], params({}, 12))
    expect(margenMedible(bajo)).toBeCloseTo(11.9, 6)
    expect(juzgar(bajo)?.tipo).toBe('bajo_piso')
    expect(margenMedible(justo)).toBeCloseTo(12, 6)
    expect(juzgar(justo)).toBeNull()
  })

  it('varias líneas Públicas con su comisión no disparan una aprobación falsa', () => {
    const publica = (id: string, precio: number, comisionPct: number | null) =>
      plan(id, precio, { tarifa_pax: { tipoTarifa: { tipo: 'publica', origen: 'persona', por: null, en: '', ...(comisionPct !== null ? { comisionPct } : {}) } } })
    const items = [hotel('h', 850_000), publica('t1', 200_000, 15), publica('t2', 150_000, 20), publica('t3', 90_000, 12)]
    const c = calcularCascada(items, params())
    expect(c.reglas!.publicasSinComision).toBe(0)
    expect(margenMedible(c)!).toBeGreaterThan(12)
    expect(juzgar(c)).toBeNull()
    // Medidas en 0 % (sin comisión y dentro de la base) habrían hundido el margen: 150.000 / 1.440.000.
    expect((150_000 / 1_440_000) * 100).toBeLessThan(12)
  })

  it('una Pública sin comisión sale de la base: tampoco pide aprobación', () => {
    const sinComision = plan('t', 500_000, { tarifa_pax: { tipoTarifa: { tipo: 'publica', origen: 'persona', por: null, en: '' } } })
    const c = calcularCascada([hotel('h', 850_000), sinComision], params())
    expect(c.reglas!.publicasSinComision).toBe(1)
    expect(margenMedible(c)).toBeCloseTo(15, 6)
    expect(juzgar(c)).toBeNull()
  })

  it('la comisión solo vale en una Pública', () => {
    expect(comisionDePublica({ tipoTarifa: { tipo: 'publica', origen: 'persona', por: null, en: '', comisionPct: 15 } })).toBe(15)
    expect(comisionDePublica({ tipoTarifa: { tipo: 'neta', origen: 'persona', por: null, en: '', comisionPct: 15 } })).toBeNull()
    expect(comisionDePublica({ tipoTarifa: { tipo: 'publica', origen: 'persona', por: null, en: '' } })).toBeNull()
  })
})

describe('la política: de la línea a la cotización', () => {
  const CONFIG = {
    margen: {
      convencion: 'sobre_venta', default_pct: 15, piso_pct: 12, aviso_pct: 12,
      reglas: {
        colchon_vuelo: { nacional: { pct: 10, piso: 30000, techo: 80000 }, internacional: { pct: 5, piso: 60000, techo: 200000 } },
        piso_hotel_pct: 10,
        puntos_extra_max: 5,
      },
    },
  }

  it('la línea declara las reglas; sin la clave no hay reglas', () => {
    expect(politicaReglasDeLinea(CONFIG)).toEqual(P)
    expect(politicaReglasDeLinea({ margen: { convencion: 'sobre_venta', default_pct: 15 } })).toBeNull()
    expect(politicaReglasDeLinea(null)).toBeNull()
  })

  it('la cotización la copia al nacer, y lo guardado se vuelve a leer igual', () => {
    const r = leerReglasDeCotizacion(reglasAlNacer(P))
    expect(r).toEqual({ politica: P, puntosExtra: 0, descuentos: [] })
    const con = reglas({ puntosExtra: 3, descuentos: [{ id: 'a', descripcion: 'Cliente recurrente', pct: 10 }] })
    expect(leerReglasDeCotizacion(reglasAJsonb(con))).toEqual(con)
    expect(leerReglasDeCotizacion(null)).toBeNull()
  })

  it('un techo por debajo del piso no se adivina: vuelve el tramo de fábrica', () => {
    const raro = politicaReglasDeLinea({ margen: { reglas: { colchon_vuelo: { nacional: { pct: 10, piso: 90000, techo: 80000 } } } } })
    expect(raro?.colchonVuelo.nacional).toEqual(P.colchonVuelo.nacional)
  })

  it('valida puntos y descuentos', () => {
    expect(motivoReglasInvalidas(P, { puntosExtra: 6 })).toMatch(/de 0 a 5/)
    expect(motivoReglasInvalidas(P, { puntosExtra: 5 })).toBeNull()
    expect(motivoReglasInvalidas(P, { descuentos: [{ descripcion: ' ', pct: 5 }] })).toMatch(/descripción/)
    expect(motivoReglasInvalidas(P, { descuentos: [{ descripcion: 'A', pct: 60 }, { descripcion: 'B', pct: 40 }] })).toMatch(/100/)
  })

  it('vuelo, hotel o lo demás por la ranura', () => {
    expect(tipoParaMargen('vuelo')).toBe('vuelo')
    expect(tipoParaMargen('vuelo 2: bogotá a madrid')).toBe('vuelo')
    expect(tipoParaMargen('hotel')).toBe('hotel')
    expect(tipoParaMargen('traslado')).toBe('otro')
    expect(tipoParaMargen(null)).toBe('otro')
  })
})
