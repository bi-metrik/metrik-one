import { describe, it, expect } from 'vitest'

import {
  ranurasConAlternativas,
  itemsFijos,
  ranurasSinResolver,
  itinerarioCompleto,
  itemsDelItinerario,
  combinacionesCartesianas,
  cascadaDeItinerario,
  motivoDeRechazo,
  textoDeRechazo,
  normalizarGrupo,
  nombreDeItinerario,
  itinerarioPrincipal,
  TOPE_COMBINACIONES,
} from './itinerarios'
import { calcularCascada } from './totales'

/** Un ítem de cotización con lo justo para las dos capas (ranura + cascada). */
function item(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    grupo: null as string | null,
    opcion_de: null as string | null,
    es_ajuste: false,
    orden: 0,
    cantidad: 1,
    subtotal: 0,
    numeroDeRubros: 0,
    costoDeRubros: 0,
    precio_venta: 0,
    precio_manual: false,
    margen_porcentaje: null as number | null,
    ...extra,
  }
}

// ── R6 · compatibilidad ──────────────────────────────────────────────────────
//
// La restricción que manda sobre todo el frente: una cotización SIN itinerarios
// tiene que comportarse EXACTAMENTE como antes. Estas pruebas están escritas
// contra la cotización que ya existe (Termotech, Arca, WMC: ítems sin `grupo`),
// no contra la de viajes.

describe('R6 · una cotización sin grupos se comporta como hoy', () => {
  const cotizacionDeSiempre = [
    item('a', { orden: 1, subtotal: 1_000_000, numeroDeRubros: 0 }),
    item('b', { orden: 2, subtotal: 500_000, numeroDeRubros: 0 }),
    item('c', { orden: 3, subtotal: 250_000, numeroDeRubros: 0 }),
  ]

  it('no declara ninguna ranura: no hay nada que elegir', () => {
    expect(ranurasConAlternativas(cotizacionDeSiempre)).toEqual([])
  })

  it('TODOS sus ítems son fijos: ninguno queda fuera de un itinerario', () => {
    expect(itemsFijos(cotizacionDeSiempre)).toEqual(['a', 'b', 'c'])
  })

  it('se considera completa sin seleccionar nada', () => {
    expect(itinerarioCompleto(cotizacionDeSiempre, [])).toBe(true)
    expect(ranurasSinResolver(cotizacionDeSiempre, [])).toEqual([])
  })

  it('el total de un itinerario vacío es IDÉNTICO al de la cotización entera', () => {
    const params = { margenPct: 15, convencionMargen: 'sobre_venta' as const }
    const completa = calcularCascada(cotizacionDeSiempre, params)
    const porItinerario = cascadaDeItinerario(cotizacionDeSiempre, [], params)

    expect(porItinerario.precioVenta).toBe(completa.precioVenta)
    expect(porItinerario.costoDeVenta).toBe(completa.costoDeVenta)
    expect(porItinerario.margenRealPct).toBe(completa.margenRealPct)
    expect(porItinerario.lineas.map(l => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('no propone ninguna combinación: no hay tabla que llenar', () => {
    expect(combinacionesCartesianas(cotizacionDeSiempre)).toEqual({
      combinaciones: [],
      truncado: false,
      total: 0,
    })
  })

  it('un `grupo` en cadena vacía se comporta igual que sin grupo', () => {
    // Alguien escribe el campo y lo borra. Si '' y null significaran cosas
    // distintas, el mismo componente suelto cambiaría de comportamiento.
    const conVacios = [item('a', { grupo: '' }), item('b', { grupo: '   ' })]
    expect(ranurasConAlternativas(conVacios)).toEqual([])
    expect(itemsFijos(conVacios)).toEqual(['a', 'b'])
  })
})

// ── Ranuras y R3 ─────────────────────────────────────────────────────────────

describe('ranuras', () => {
  const viaje = [
    item('vuelo-avianca', { grupo: 'vuelo', orden: 1 }),
    item('vuelo-wingo', { grupo: 'vuelo', opcion_de: 'vuelo-avianca', orden: 2 }),
    item('hotel-occ', { grupo: 'hotel', orden: 3 }),
    item('hotel-hr', { grupo: 'hotel', opcion_de: 'hotel-occ', orden: 4 }),
    item('traslado', { grupo: 'traslado', orden: 5 }),
    item('seguro', { orden: 6 }),
  ]

  it('solo son ranura los grupos con MÁS DE UN candidato', () => {
    expect(ranurasConAlternativas(viaje)).toEqual([
      { grupo: 'vuelo', candidatos: ['vuelo-avianca', 'vuelo-wingo'] },
      { grupo: 'hotel', candidatos: ['hotel-occ', 'hotel-hr'] },
    ])
  })

  it('R3 · el traslado único y el seguro entran solos, sin teclearlos', () => {
    expect(itemsFijos(viaje)).toEqual(['traslado', 'seguro'])
  })

  it('R3 · y aparecen en TODO itinerario, sin estar en la selección', () => {
    const compuesto = itemsDelItinerario(viaje, ['vuelo-wingo', 'hotel-hr'])
    expect(compuesto).toEqual(['vuelo-wingo', 'hotel-hr', 'traslado', 'seguro'])
  })

  it('el ítem de ajuste NO es candidato de ninguna ranura', () => {
    // Es cuadre de precio, no un componente que alguien pueda elegir. Si entrara,
    // sería una columna más de la tabla de combinaciones.
    const conAjuste = [...viaje, item('cuadre', { grupo: 'vuelo', es_ajuste: true, orden: 9 })]
    expect(ranurasConAlternativas(conAjuste)[0].candidatos).toEqual(['vuelo-avianca', 'vuelo-wingo'])
    expect(itemsDelItinerario(conAjuste, ['vuelo-wingo', 'hotel-hr'])).not.toContain('cuadre')
  })

  it('el orden del itinerario es el de la cotización, no el de la selección', () => {
    const compuesto = itemsDelItinerario(viaje, ['hotel-hr', 'vuelo-avianca'])
    expect(compuesto).toEqual(['vuelo-avianca', 'hotel-hr', 'traslado', 'seguro'])
  })
})

// ── R2 · completitud ─────────────────────────────────────────────────────────

describe('R2 · un itinerario resuelve exactamente una opción por ranura', () => {
  const viaje = [
    item('v1', { grupo: 'vuelo', orden: 1 }),
    item('v2', { grupo: 'vuelo', orden: 2 }),
    item('h1', { grupo: 'hotel', orden: 3 }),
    item('h2', { grupo: 'hotel', orden: 4 }),
  ]

  it('nombra las ranuras que faltan, no solo que falta algo', () => {
    expect(ranurasSinResolver(viaje, ['v1'])).toEqual(['hotel'])
    expect(ranurasSinResolver(viaje, [])).toEqual(['vuelo', 'hotel'])
  })

  it('dos opciones del MISMO grupo dejan la ranura sin resolver', () => {
    // Sin esto, el total sumaría los dos vuelos y el margen saldría de un viaje
    // que nadie va a comprar.
    expect(ranurasSinResolver(viaje, ['v1', 'v2', 'h1'])).toEqual(['vuelo'])
    expect(itinerarioCompleto(viaje, ['v1', 'v2', 'h1'])).toBe(false)
  })

  it('una selección completa no deja ranuras', () => {
    expect(itinerarioCompleto(viaje, ['v2', 'h1'])).toBe(true)
  })

  it('una opción que ya no existe deja la ranura sin resolver, no revienta', () => {
    // Alguien borró el ítem. El itinerario queda incompleto y la pantalla lo dice;
    // reventar aquí dejaría la cotización entera sin poder abrirse.
    expect(ranurasSinResolver(viaje, ['borrado', 'h1'])).toEqual(['vuelo'])
    expect(itemsDelItinerario(viaje, ['borrado', 'h1'])).toEqual(['h1'])
  })
})

// ── T1 · el cartesiano ───────────────────────────────────────────────────────

describe('T1 · generar combinaciones', () => {
  it('3 vuelos × 3 hoteles son las NUEVE del caso real', () => {
    const items = [
      ...['a', 'b', 'c'].map((s, i) => item(`v-${s}`, { grupo: 'vuelo', orden: i })),
      ...['x', 'y', 'z'].map((s, i) => item(`h-${s}`, { grupo: 'hotel', orden: 10 + i })),
      item('traslado', { grupo: 'traslado', orden: 20 }),
    ]
    const { combinaciones, truncado, total } = combinacionesCartesianas(items)
    expect(total).toBe(9)
    expect(truncado).toBe(false)
    expect(combinaciones).toHaveLength(9)
    // Cada una es completa por construcción: ese es el punto de generarlas.
    for (const sel of combinaciones) expect(itinerarioCompleto(items, sel)).toBe(true)
    // Y son nueve DISTINTAS, no la misma nueve veces.
    expect(new Set(combinaciones.map(c => c.join('|'))).size).toBe(9)
  })

  it('no genera nada cuando no hay ranuras', () => {
    expect(combinacionesCartesianas([item('a'), item('b')]).combinaciones).toEqual([])
  })

  it('se corta en el tope y lo DICE, en vez de colgar la pantalla', () => {
    // 6 ranuras de 4 opciones = 4.096 filas. Eso no es una tabla que alguien
    // revise: es 4.096 inserts y un navegador pegado.
    const items = []
    for (let g = 0; g < 6; g++) {
      for (let o = 0; o < 4; o++) items.push(item(`g${g}-o${o}`, { grupo: `g${g}`, orden: g * 10 + o }))
    }
    const { combinaciones, truncado, total } = combinacionesCartesianas(items)
    expect(total).toBe(4096)
    expect(truncado).toBe(true)
    expect(combinaciones.length).toBeLessThanOrEqual(TOPE_COMBINACIONES)
    expect(combinaciones.length).toBeGreaterThan(0)
  })
})

// ── R5 · totales por itinerario ──────────────────────────────────────────────

describe('R5 · el total sale del itinerario, no de la cotización entera', () => {
  // El caso medido: mismo hotel, mismas fechas, dos aerolíneas.
  const viaje = [
    item('avianca', { grupo: 'vuelo', orden: 1, subtotal: 2_000_000 }),
    item('wingo', { grupo: 'vuelo', orden: 2, subtotal: 1_825_000 }),
    item('occidental', { grupo: 'hotel', orden: 3, subtotal: 1_350_000 }),
    item('traslado', { grupo: 'traslado', orden: 4, subtotal: 0 }),
  ]
  const params = { margenPct: 13, convencionMargen: 'sobre_venta' as const }

  it('cada combinación tiene su propio costo y su propio margen', () => {
    const conAvianca = cascadaDeItinerario(viaje, ['avianca'], params)
    const conWingo = cascadaDeItinerario(viaje, ['wingo'], params)

    expect(conAvianca.costoDirecto).toBe(3_350_000)
    expect(conWingo.costoDirecto).toBe(3_175_000)
    expect(conAvianca.precioVenta).toBeGreaterThan(conWingo.precioVenta)
  })

  it('el total del itinerario NO incluye la opción no elegida', () => {
    const conWingo = cascadaDeItinerario(viaje, ['wingo'], params)
    const sumaDeTodo = calcularCascada(viaje, params)
    expect(conWingo.costoDirecto).toBeLessThan(sumaDeTodo.costoDirecto)
    expect(conWingo.lineas.map(l => l.id)).toEqual(['wingo', 'occidental', 'traslado'])
  })

  it('el margen de un itinerario es el de SU cascada, con la misma aritmética', () => {
    const sel = ['avianca']
    const porItinerario = cascadaDeItinerario(viaje, sel, params)
    const incluidos = new Set(itemsDelItinerario(viaje, sel))
    const aMano = calcularCascada(viaje.filter(i => incluidos.has(i.id)), params)
    expect(porItinerario.margenRealPct).toBe(aMano.margenRealPct)
  })
})

// ── 2.6.4 · el piso RECHAZA ──────────────────────────────────────────────────

describe('§2.6.4 · el piso de margen bloquea marcar va_en_propuesta', () => {
  it('deja pasar un itinerario completo por encima del piso', () => {
    expect(motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: 13, pisoPct: 5 })).toBeNull()
  })

  it('rechaza por debajo del piso', () => {
    const motivo = motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: 3.1, pisoPct: 5 })
    expect(motivo).toEqual({ tipo: 'bajo_piso', margenRealPct: 3.1, pisoPct: 5 })
    expect(textoDeRechazo(motivo!)).toContain('3,1%')
    expect(textoDeRechazo(motivo!)).toContain('5,0%')
  })

  it('JUSTO en el piso pasa: el piso es el mínimo aceptable, no el primero que sobra', () => {
    expect(motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: 5, pisoPct: 5 })).toBeNull()
  })

  it('un margen negativo cae en bajo_piso, que es el caso que más importa', () => {
    const motivo = motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: -6.5, pisoPct: 5 })
    expect(motivo?.tipo).toBe('bajo_piso')
  })

  it('un margen que NO se puede medir tampoco pasa', () => {
    // Sin costo cargado, un itinerario regalado se ve idéntico a uno sano. Dejarlo
    // salir por no poder juzgarlo convierte el candado en decorado.
    const motivo = motivoDeRechazo({ ranurasFaltantes: [], margenRealPct: null, pisoPct: 5 })
    expect(motivo?.tipo).toBe('bajo_piso')
    expect(textoDeRechazo(motivo!)).toContain('margen medible')
  })

  it('la completitud se reporta ANTES que el margen', () => {
    // Un itinerario al que le falta el hotel tiene un margen que no significa nada.
    // Decir "bajo el piso" ahí manda a subir un precio cuando falta elegir el hotel.
    const motivo = motivoDeRechazo({ ranurasFaltantes: ['hotel'], margenRealPct: 0, pisoPct: 5 })
    expect(motivo).toEqual({ tipo: 'incompleto', grupos: ['hotel'] })
    expect(textoDeRechazo(motivo!)).toContain('hotel')
  })

  it('nombra TODAS las ranuras que faltan', () => {
    const motivo = motivoDeRechazo({ ranurasFaltantes: ['vuelo', 'hotel'], margenRealPct: null, pisoPct: 5 })
    const texto = textoDeRechazo(motivo!)
    expect(texto).toContain('vuelo')
    expect(texto).toContain('hotel')
  })
})

// ── Auxiliares ───────────────────────────────────────────────────────────────

describe('auxiliares', () => {
  it('normalizarGrupo trata vacío y espacios como sin grupo', () => {
    expect(normalizarGrupo(null)).toBeNull()
    expect(normalizarGrupo(undefined)).toBeNull()
    expect(normalizarGrupo('')).toBeNull()
    expect(normalizarGrupo('  ')).toBeNull()
    expect(normalizarGrupo(' vuelo ')).toBe('vuelo')
  })

  it('T6 · el itinerario sin nombre se numera', () => {
    expect(nombreDeItinerario('Recomendada', 1)).toBe('Recomendada')
    expect(nombreDeItinerario(null, 2)).toBe('Opción 2')
    expect(nombreDeItinerario('   ', 3)).toBe('Opción 3')
  })

  it('sin principal devuelve null, no "el primero"', () => {
    // Elegir el primero le cambiaría el precio a la cotización sin que nadie lo
    // haya decidido.
    expect(itinerarioPrincipal([{ id: 'a' }, { id: 'b' }])).toBeNull()
    expect(itinerarioPrincipal([{ id: 'a' }, { id: 'b', es_principal: true }])?.id).toBe('b')
  })
})
