import { describe, expect, it } from 'vitest'

import fixture from './__fixtures__/cot-2026-0013-hoteles.fixture.json'
import {
  agregarHabitacion,
  claveOpcionHotel,
  costoPorTipoDeHabitaciones,
  habitacionesDeTarifa,
  menoresDeDosAnios,
  mismaImagenEnHabitaciones,
  mismaOpcionHotel,
  mismasFechasHotel,
  opcionDelMismoHotel,
  precioPorHabitacion,
  recibeHabitaciones,
  repartirHabitaciones,
  resolverHabitaciones,
  resolverTarifaDeOpcion,
  sobraLaCaptura,
  tarifaConHabitaciones,
  textoDeCupos,
  textoDeFaltantes,
} from './habitaciones'
import {
  confirmacionDesactualizada,
  firmaDeHabitaciones,
  leerTarifaPax,
  type Composicion,
  type Habitacion,
  type LecturaCasilla,
  type TarifaPax,
} from './tarifa-pasajero'

// ── El caso real: COT-2026-0013 (copiado, no leído de la base) ────────────────

const GRUPO: Composicion = fixture.grupo
const LECTURAS = fixture.hoteles.map(h => ({ item: h.item, lectura: h.lectura as unknown as LecturaCasilla }))
const porItem = (id: string) => LECTURAS.find(l => l.item === id)!.lectura

const AGUA_DULCE = ['efb0a3c3', 'f9fbc4d5', '5542356a']
const ENILDA = ['2164b941', '68d431db', '7944d5cc']
const habitacionesDe = (ids: string[]): Habitacion[] => ids.map(id => ({ id, lectura: porItem(id) }))

/** Agrupa las lecturas por opción (hotel + entrada + salida), en el orden de llegada. */
function agrupar(lecturas: LecturaCasilla[]): LecturaCasilla[][] {
  const grupos: LecturaCasilla[][] = []
  for (const l of lecturas) {
    const g = grupos.find(x => mismaOpcionHotel(x[0], l))
    if (g) g.push(l)
    else grupos.push([l])
  }
  return grupos
}

describe('R8 · COT-2026-0013: seis capturas son dos opciones de tres habitaciones', () => {
  it('las seis caben en UNA ranura: mismas fechas', () => {
    const [primera, ...resto] = LECTURAS.map(l => l.lectura)
    for (const l of resto) expect(mismasFechasHotel(primera, l)).toBe(true)
  })

  it('dos opciones, una por hotel, con tres habitaciones cada una', () => {
    const grupos = agrupar(LECTURAS.map(l => l.lectura))
    expect(grupos).toHaveLength(2)
    expect(grupos.map(g => g.length)).toEqual([3, 3])
    expect(grupos.map(g => claveOpcionHotel(g[0])!.hotel)).toEqual(['Cabañas Agua Dulce', 'Posada Enilda'])
  })

  it('Posada Enilda cubre el grupo exacto: el «niño (0 años)» cuenta como infante', () => {
    const r = repartirHabitaciones(habitacionesDe(ENILDA), GRUPO)
    expect(r.cubiertos).toEqual({ adultos: 6, ninos: 1, infantes: 1 })
    expect(textoDeCupos(r)).toBe('6/6 adultos · 1/1 niño · 1/1 infante')
    expect(textoDeFaltantes(r)).toBeNull()
    expect(r.habitaciones.map(h => h.numero)).toEqual([1, 2, 3])
    expect(r.costoTotal).toBeCloseTo(403718.34 + 412689.86 * 2, 2)
  })

  it('Posada Enilda va por habitación: la de solo adultos es otro tipo y no sirve para restar (regla 8)', () => {
    const tarifa = tarifaConHabitaciones({}, habitacionesDe(ENILDA), GRUPO)
    const e = resolverHabitaciones(tarifa, GRUPO)
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costos).toEqual([])
    expect(e.porHabitacion?.map(h => h.numero)).toEqual([1, 2, 3])
    expect(e.porHabitacion?.map(h => h.total)).toEqual([403718.34, 412689.86, 412689.86])
    expect(e.costoTotal).toBeCloseTo(1229098.06, 2)
  })

  it('Agua Dulce tal como está guardada: la captura del infante no dice su edad, y el bloque lo dice', () => {
    const r = repartirHabitaciones(habitacionesDe(AGUA_DULCE), GRUPO)
    expect(r.cubiertos).toEqual({ adultos: 6, ninos: 2, infantes: 0 })
    expect(textoDeCupos(r)).toBe('6/6 adultos · 2/1 niños · 0/1 infante')
    expect(textoDeFaltantes(r)).toBe('Falta cotizar 1 infante. Sobra 1 niño.')
  })

  it('Agua Dulce recapturada con «1 niño (1 año)»: 8/8, y el menor sale de restar (vale $0)', () => {
    const conEdad = relectura(porItem('f9fbc4d5'), '2 adultos, 1 niño (1 año)')
    const habs: Habitacion[] = [
      { id: 'efb0a3c3', lectura: porItem('efb0a3c3') },
      { id: 'f9fbc4d5', lectura: conEdad },
      { id: '5542356a', lectura: porItem('5542356a') },
    ]
    const r = repartirHabitaciones(habs, GRUPO)
    expect(textoDeCupos(r)).toBe('6/6 adultos · 1/1 niño · 1/1 infante')
    const costos = costoPorTipoDeHabitaciones(r)!
    expect(costos.map(c => [c.tipo, c.cantidad])).toEqual([['adulto', 6], ['nino', 1], ['infante', 1]])
    expect(costos.find(c => c.tipo === 'nino')!.total).toBe(0)
    expect(costos.find(c => c.tipo === 'infante')!.total).toBe(0)
    const suma = costos.reduce((a, c) => a + c.total, 0)
    expect(suma).toBeCloseTo(r.costoTotal, 1)
  })
})

/** La misma lectura con otro texto de ocupación (lo que devolvería el lector al recapturar). */
function relectura(l: LecturaCasilla, ocupacion: string): LecturaCasilla {
  return {
    ...l,
    campos: l.campos.map(c => (/ocupaci/i.test(c.label) ? { ...c, valor: ocupacion } : c)),
  }
}

// ── Reglas con casos chicos ──────────────────────────────────────────────────

function hab(
  id: string,
  ocupacion: { adultos: number; ninos?: number; infantes?: number },
  total: number,
  tipo = 'Doble Standard',
  extra: Partial<Habitacion> = {},
): Habitacion {
  const lectura: LecturaCasilla = {
    campos: [{ label: 'Ocupación', valor: `${ocupacion.adultos} adultos` }],
    total,
    moneda: 'COP',
    nombre: 'Hotel Prueba',
    leidaEn: '2026-09-24T00:00:00Z',
    identidad: { hotel: 'Hotel Prueba', check_in: '2026-11-23', check_out: '2026-11-25', tipo_habitacion: tipo },
    ocupacion: { adultos: ocupacion.adultos, ninos: ocupacion.ninos ?? 0, infantes: ocupacion.infantes ?? 0, total: null },
    porTipo: [],
    alertas: [],
  } as unknown as LecturaCasilla
  return { id, lectura, ...extra }
}

describe('R8 · sumar, restar y «solo para restar»', () => {
  it('restar: la de solo adultos del mismo tipo da el precio del menor', () => {
    const grupo = { adultos: 2, ninos: 1, infantes: 0 }
    const r = repartirHabitaciones([hab('a', { adultos: 2, ninos: 1 }, 500), hab('b', { adultos: 2 }, 400)], grupo)
    expect(r.habitaciones.map(h => h.rol)).toEqual(['habitacion', 'referencia'])
    expect(r.habitaciones[1].numero).toBeNull()
    expect(r.habitaciones[1].sirveParaRestar).toBe(true)
    const costos = costoPorTipoDeHabitaciones(r)!
    expect(costos).toEqual([
      expect.objectContaining({ tipo: 'adulto', cantidad: 2, total: 400 }),
      expect.objectContaining({ tipo: 'nino', cantidad: 1, total: 100 }),
    ])
    expect(r.costoTotal).toBe(500)
  })

  it('con el grupo incompleto la de solo adultos es habitación, y pasa sola a «solo para restar» cuando otra llena el grupo', () => {
    const grupo = { adultos: 4, ninos: 1, infantes: 0 }
    const uno = [hab('a', { adultos: 2 }, 400)]
    expect(repartirHabitaciones(uno, grupo).habitaciones[0].rol).toBe('habitacion')
    const dos = [...uno, hab('b', { adultos: 2, ninos: 1 }, 500)]
    expect(repartirHabitaciones(dos, grupo).habitaciones.map(h => h.rol)).toEqual(['habitacion', 'habitacion'])
    const tres = [...dos, hab('c', { adultos: 2 }, 400)]
    const r = repartirHabitaciones(tres, grupo)
    expect(r.habitaciones.map(h => h.rol)).toEqual(['habitacion', 'habitacion', 'referencia'])
    expect(r.habitaciones.map(h => h.numero)).toEqual([1, 2, null])
    expect(textoDeCupos(r)).toBe('4/4 adultos · 1/1 niño')
  })

  it('lo que fija una persona manda sobre el reparto', () => {
    const grupo = { adultos: 2, ninos: 1, infantes: 0 }
    const r = repartirHabitaciones(
      [
        hab('a', { adultos: 2, ninos: 1 }, 500),
        hab('b', { adultos: 2 }, 400, 'Doble Standard', { rolManual: { valor: 'habitacion', por: 'Ale', porId: 'x', en: '2026-09-24' } }),
      ],
      grupo,
    )
    expect(r.habitaciones.map(h => h.rol)).toEqual(['habitacion', 'habitacion'])
    expect(textoDeFaltantes(r)).toBe('Sobran 2 adultos.')
  })

  it('una habitación con menor sin par de su tipo no se parte: va por habitación', () => {
    const grupo = { adultos: 4, ninos: 1, infantes: 0 }
    const r = repartirHabitaciones([hab('a', { adultos: 2, ninos: 1 }, 500), hab('b', { adultos: 2 }, 300, 'Suite')], grupo)
    expect(costoPorTipoDeHabitaciones(r)).toBeNull()
  })
})

describe('R8 · P10 para hoteles: repetida solo si ya sobra', () => {
  it('dos habitaciones iguales NO son repetidas', () => {
    const grupo = { adultos: 4, ninos: 0, infantes: 0 }
    const una = [hab('a', { adultos: 2 }, 400)]
    expect(sobraLaCaptura(una, hab('b', { adultos: 2 }, 400).lectura, grupo)).toBe(false)
  })

  it('con el grupo completo, otra igual sí sobra', () => {
    const grupo = { adultos: 4, ninos: 0, infantes: 0 }
    const dos = [hab('a', { adultos: 2 }, 400), hab('b', { adultos: 2 }, 400)]
    expect(sobraLaCaptura(dos, hab('c', { adultos: 2 }, 400).lectura, grupo)).toBe(true)
  })

  it('con el grupo completo, la de solo adultos que sirve para restar NO sobra', () => {
    const grupo = { adultos: 2, ninos: 1, infantes: 0 }
    const una = [hab('a', { adultos: 2, ninos: 1 }, 500)]
    expect(sobraLaCaptura(una, hab('b', { adultos: 2 }, 400).lectura, grupo)).toBe(false)
  })

  it('sin grupo del negocio nunca se afirma que sobra', () => {
    expect(sobraLaCaptura([hab('a', { adultos: 2 }, 400)], hab('b', { adultos: 2 }, 400).lectura, null)).toBe(false)
  })
})

describe('R8 · regla 7: menos de 2 años es infante', () => {
  it('lee las edades del texto de ocupación', () => {
    expect(menoresDeDosAnios('2 adultos, 1 niño (0 años), 1 habitación')).toBe(1)
    expect(menoresDeDosAnios('1 niño (1 año)')).toBe(1)
    expect(menoresDeDosAnios('2 adultos, 1 niño (5 años)')).toBe(0)
    expect(menoresDeDosAnios('2 niños (1 y 5 años)')).toBe(1)
    expect(menoresDeDosAnios('2 Adultos - 1 Niño')).toBe(0)
    expect(menoresDeDosAnios(null)).toBe(0)
  })
})

describe('R8 · lo guardado', () => {
  it('una opción de siempre es UNA habitación, y leerla no agrega nada (R6)', () => {
    const lectura = porItem('7944d5cc')
    const guardado = { casillas: { grupo_completo: lectura }, composicion: { adultos: 2, ninos: 1, infantes: 0 } }
    const t = leerTarifaPax(JSON.parse(JSON.stringify(guardado)))
    expect('habitaciones' in t).toBe(false)
    expect(habitacionesDeTarifa(t)).toEqual([{ id: 'grupo_completo', lectura: t.casillas!.grupo_completo }])
  })

  it('agregar una habitación deja la composición en lo que cubren y el pantallazo 1 al día', () => {
    const base = { casillas: { grupo_completo: porItem('2164b941') } }
    const t = agregarHabitacion(base, { id: 'h2', lectura: porItem('68d431db') }, GRUPO)
    expect(t.habitaciones!.map(h => h.id)).toEqual(['grupo_completo', 'h2'])
    expect(t.composicion).toEqual({ adultos: 4, ninos: 0, infantes: 1 })
    expect(t.casillas!.grupo_completo!.paraComposicion).toEqual({ adultos: 4, ninos: 0, infantes: 1 })
    const leida = leerTarifaPax(JSON.parse(JSON.stringify(t)))
    expect(leida.habitaciones!.map(h => h.id)).toEqual(['grupo_completo', 'h2'])
  })

  it('una confirmación con otra lista de habitaciones queda vieja', () => {
    const habs = habitacionesDe(ENILDA)
    const t = tarifaConHabitaciones({}, habs.slice(0, 2), GRUPO)
    const confirmada: TarifaPax = {
      ...t,
      confirmada: {
        composicion: t.composicion!,
        costos: [],
        costoTotalCOP: 0,
        moneda: 'COP',
        tasa: null,
        confirmadaEn: '2026-09-24',
        firmaHabitaciones: firmaDeHabitaciones(t.habitaciones!),
      },
    }
    expect(confirmacionDesactualizada(confirmada, t.composicion ?? null)).toBeNull()
    const con3 = { ...confirmada, ...tarifaConHabitaciones(confirmada, habs, GRUPO) }
    expect(confirmacionDesactualizada(con3, con3.composicion ?? null)?.motivo).toBe('composicion')
  })
})

describe('R8 · la bandeja une las seis capturas de COT-2026-0013 en dos opciones', () => {
  /**
   * Lo que hace `unirHotelComoHabitacion`, en fila, con la tarifa en memoria: cada captura nace
   * en su propia opción y, si hay otra del mismo hotel y fechas, se vuelve habitación de ella.
   */
  function pegarEnLaBandeja(orden: string[]) {
    let opciones: { id: string; tarifa: TarifaPax }[] = []
    const sobrantes: string[] = []
    for (const id of orden) {
      const propia = porItem(id)
      const destino = opcionDelMismoHotel(propia, opciones)
      if (!destino) {
        opciones = [...opciones, { id, tarifa: { casillas: { grupo_completo: propia } } }]
        continue
      }
      const suyas = habitacionesDeTarifa(destino.tarifa)
      if (mismaImagenEnHabitaciones(suyas, propia.huellaImagen) || sobraLaCaptura(suyas, propia, GRUPO)) {
        sobrantes.push(id)
        continue
      }
      opciones = opciones.map(o => (o.id === destino.id
        ? { ...o, tarifa: agregarHabitacion(o.tarifa, { id, lectura: propia }, GRUPO) }
        : o))
    }
    return { opciones, sobrantes }
  }

  it('pegadas intercaladas: dos opciones de tres habitaciones, ninguna sobra', () => {
    const { opciones, sobrantes } = pegarEnLaBandeja(['2164b941', 'efb0a3c3', '68d431db', 'f9fbc4d5', '7944d5cc', '5542356a'])
    expect(sobrantes).toEqual([])
    expect(opciones.map(o => habitacionesDeTarifa(o.tarifa).length)).toEqual([3, 3])
    expect(opciones.map(o => claveOpcionHotel(habitacionesDeTarifa(o.tarifa)[0].lectura)!.hotel)).toEqual(['Posada Enilda', 'Cabañas Agua Dulce'])
    const enilda = opciones[0].tarifa
    expect(textoDeCupos(repartirHabitaciones(habitacionesDeTarifa(enilda), GRUPO))).toBe('6/6 adultos · 1/1 niño · 1/1 infante')
    // La opción queda cubriendo lo que cubren sus habitaciones: nada compara contra una
    // composición vieja.
    expect(enilda.composicion).toEqual({ adultos: 6, ninos: 1, infantes: 1 })
  })

  it('una séptima captura de Enilda, con el grupo ya cubierto, sobra (regla 6)', () => {
    const otra = { ...porItem('2164b941'), huellaImagen: 'otra-imagen' }
    const destino = opcionDelMismoHotel(otra, pegarEnLaBandeja(ENILDA).opciones)!
    expect(sobraLaCaptura(habitacionesDeTarifa(destino.tarifa), otra, GRUPO)).toBe(true)
  })

  it('la misma imagen dos veces no es otra habitación', () => {
    const conHuella = { ...porItem('2164b941'), huellaImagen: 'h-1' }
    const tarifa = tarifaConHabitaciones({}, [{ id: 'a', lectura: conHuella }], GRUPO)
    expect(mismaImagenEnHabitaciones(habitacionesDeTarifa(tarifa), 'h-1')).toBe(true)
    expect(mismaImagenEnHabitaciones(habitacionesDeTarifa(tarifa), 'h-2')).toBe(false)
  })

  it('una opción que se cotiza restando capturas no recibe habitaciones', () => {
    const l = porItem('2164b941')
    expect(recibeHabitaciones({ casillas: { grupo_completo: l } })).toBe(true)
    expect(recibeHabitaciones({ casillas: { grupo_completo: l, solo_adultos: l } })).toBe(false)
    expect(opcionDelMismoHotel(l, [{ id: 'x', tarifa: { casillas: { grupo_completo: l, sin_infantes: l } } }])).toBeNull()
  })

  it('sin hotel o sin fechas en la captura no se une a nada', () => {
    const sinFechas = { ...porItem('2164b941'), identidad: { ...porItem('2164b941').identidad, check_in: null } }
    expect(opcionDelMismoHotel(sinFechas as LecturaCasilla, [{ id: 'x', tarifa: { casillas: { grupo_completo: porItem('68d431db') } } }])).toBeNull()
  })
})

describe('R8 · una sola puerta para el estado de la tarifa, y el precio por habitación', () => {
  it('con habitaciones manda el reparto contra el grupo; sin ellas, el camino de siempre', () => {
    const conHabs = tarifaConHabitaciones({}, habitacionesDe(ENILDA), GRUPO)
    expect(resolverTarifaDeOpcion(conHabs, conHabs.composicion ?? null, GRUPO, 'hotel_detalle')).toMatchObject({ estado: 'resuelta', origen: 'habitaciones' })
    const deSiempre: TarifaPax = { casillas: { grupo_completo: porItem('2164b941') } }
    const e = resolverTarifaDeOpcion(deSiempre, { adultos: 2, ninos: 0, infantes: 0 }, GRUPO, 'hotel_detalle')
    expect(e?.estado === 'resuelta' && e.origen).not.toBe('habitaciones')
    expect(resolverTarifaDeOpcion({}, null, GRUPO, 'hotel_detalle')).toBeNull()
  })

  it('lo que falta del grupo se dice en el mensaje, sin frenar la confirmación', () => {
    const e = resolverHabitaciones(tarifaConHabitaciones({}, habitacionesDe(AGUA_DULCE), GRUPO), GRUPO)
    expect(e.estado).toBe('resuelta')
    expect(e.mensaje).toMatch(/^Falta cotizar 1 infante/)
  })

  it('el precio de la línea se reparte entre habitaciones y suma exacto', () => {
    const filas = [
      { numero: 1, ocupacion: { adultos: 2, ninos: 0, infantes: 0 }, totalCOP: 403718.34 },
      { numero: 2, ocupacion: { adultos: 2, ninos: 0, infantes: 1 }, totalCOP: 412689.86 },
      { numero: 3, ocupacion: { adultos: 2, ninos: 1, infantes: 0 }, totalCOP: 412689.86 },
    ]
    const precios = precioPorHabitacion(filas, 1_500_000)
    expect(precios.map(p => p.numero)).toEqual([1, 2, 3])
    expect(precios.reduce((a, p) => a + p.precio, 0)).toBe(1_500_000)
    // Dos habitaciones del mismo costo quedan iguales, o a un peso por el redondeo.
    expect(Math.abs(precios[1].precio - precios[2].precio)).toBeLessThanOrEqual(1)
    expect(precioPorHabitacion([], 1_000)).toEqual([])
  })
})
