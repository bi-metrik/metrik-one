/**
 * Varias ranuras del mismo tipo: «Vuelo 1» y «Vuelo 2» SUMAN, sus variantes compiten.
 *
 * El caso real es el viaje a Providencia (Mauricio, 2026-09-21): Bogotá–San Andrés y
 * San Andrés–Providencia van los dos en lo que recibe el cliente.
 *
 * Lo que estas pruebas fijan, y en este orden de importancia:
 *
 *  1. R6 — un grupo que hoy resuelve sigue resolviendo, y uno que hoy NO resuelve
 *     (`Hotel Occidental`, `dia-1`) sigue sin resolver.
 *  2. Dos instancias del mismo tipo son dos ranuras: suman.
 *  3. Dentro de una, las variantes compiten.
 */

import { describe, expect, it } from 'vitest'

import {
  etiquetaDeRanura,
  grupoCombinable,
  grupoDeInstancia,
  mismaRanura,
  ranuraDeGrupo,
  ranuraPorSlug,
  resolverRanura,
  siguienteGrupoDeTipo,
} from './ranuras-pantallazo'
import {
  cascadaDeItinerario,
  itemsQueAportanAlTotal,
  ranurasCombinables,
  ranurasSinResolver,
} from './itinerarios'
import { avisosDeCobertura, type LineaParaCobertura } from './cobertura-opciones'
import { puedeLlevarDia, puedeSerSugerido } from './dia-relativo'
import type { LecturaCasilla } from './tarifa-pasajero'

const VUELO = ranuraPorSlug('vuelo_detalle')!
const HOTEL = ranuraPorSlug('hotel_detalle')!

describe('resolverRanura · R6 primero', () => {
  it('los grupos de siempre resuelven igual y SIN etiqueta', () => {
    for (const g of ['vuelo', 'vuelos', 'aereo', 'aéreo', 'tiquete', 'tiquetes']) {
      expect(resolverRanura(g)).toEqual({ definicion: VUELO, numero: null, nombre: null })
    }
    for (const g of ['hotel', 'hoteles', 'alojamiento', 'hospedaje', 'Hotel', '  HOTELES ']) {
      expect(resolverRanura(g)).toEqual({ definicion: HOTEL, numero: null, nombre: null })
    }
  })

  it('lo que NO era ranura sigue sin serlo', () => {
    // El nombre de un proveedor no es una ranura, y es la razón exacta por la que la
    // etiqueta separada por espacio tiene que ser un número.
    expect(resolverRanura('Hotel Occidental')).toBeNull()
    expect(resolverRanura('Vuelo directo')).toBeNull()
    expect(resolverRanura('dia-1')).toBeNull()
    expect(resolverRanura('seguro')).toBeNull()
    expect(resolverRanura('')).toBeNull()
    expect(resolverRanura(null)).toBeNull()
    // Un grupo con dos puntos cuya cabeza no es una ranura tampoco lo es.
    expect(resolverRanura('extras: propinas')).toBeNull()
  })
})

describe('resolverRanura · instancias', () => {
  it('reconoce la etiqueta numérica', () => {
    expect(resolverRanura('vuelo 2')).toEqual({ definicion: VUELO, numero: 2, nombre: null })
    expect(resolverRanura('Vuelo 2')).toEqual({ definicion: VUELO, numero: 2, nombre: null })
    expect(resolverRanura('hoteles 3')).toEqual({ definicion: HOTEL, numero: 3, nombre: null })
  })

  it('reconoce la etiqueta libre tras los dos puntos', () => {
    expect(resolverRanura('vuelo: Bogotá a San Andrés')).toEqual({
      definicion: VUELO,
      numero: null,
      nombre: 'Bogotá a San Andrés',
    })
    // El ordinal y el nombre conviven: renombrar «vuelo 2» conserva el 2.
    expect(resolverRanura('vuelo 2: San Andrés a Providencia')).toEqual({
      definicion: VUELO,
      numero: 2,
      nombre: 'San Andrés a Providencia',
    })
    // Sin nada a la derecha es la primera, no una instancia sin nombre.
    expect(resolverRanura('vuelo:')).toEqual({ definicion: VUELO, numero: null, nombre: null })
  })

  it('«Vuelo 2» gana la caja de pantallazo y abre columna', () => {
    // Es el bloqueo concreto que abre el encargo: hoy pierde las dos cosas.
    expect(ranuraDeGrupo('vuelo 2')?.slug).toBe('vuelo_detalle')
    expect(grupoCombinable('vuelo 2')).toBe(true)
    expect(grupoCombinable('vuelo: Bogotá a San Andrés')).toBe(true)
    expect(grupoCombinable('Hotel Occidental')).toBe(false)
  })

  it('dos instancias del mismo tipo NO son la misma ranura', () => {
    expect(mismaRanura('vuelo', 'vuelo 2')).toBe(false)
    expect(mismaRanura('vuelo', 'VUELO')).toBe(true)
    expect(mismaRanura('vuelo', null)).toBe(false)
  })
})

describe('etiquetaDeRanura · el tipo siempre se dice', () => {
  it.each([
    ['vuelo', 'Vuelo'],
    ['tiquetes', 'Vuelo'],
    ['vuelo 2', 'Vuelo 2'],
    ['vuelo: Bogotá a San Andrés', 'Vuelo · Bogotá a San Andrés'],
    ['vuelo 2: San Andrés a Providencia', 'Vuelo 2 · San Andrés a Providencia'],
    ['hoteles 3', 'Hotel 3'],
    ['dia-1', 'dia-1'],
    ['seguro', 'seguro'],
  ])('%s → %s', (grupo, esperado) => {
    expect(etiquetaDeRanura(grupo)).toBe(esperado)
  })
})

describe('grupoDeInstancia · se escribe desde el canónico', () => {
  it('normaliza el sinónimo para que dos ranuras iguales no queden escritas distinto', () => {
    expect(grupoDeInstancia(HOTEL, { numero: 2 })).toBe('hotel 2')
    expect(grupoDeInstancia(VUELO, { nombre: 'Bogotá a San Andrés' })).toBe('vuelo: Bogotá a San Andrés')
    expect(grupoDeInstancia(VUELO, { numero: 2, nombre: 'San Andrés a Providencia' }))
      .toBe('vuelo 2: San Andrés a Providencia')
    expect(grupoDeInstancia(VUELO, {})).toBe('vuelo')
    expect(grupoDeInstancia(VUELO, { nombre: '   ' })).toBe('vuelo')
    // El 1 no se escribe: la primera ranura de un tipo es «vuelo» a secas (R6).
    expect(grupoDeInstancia(VUELO, { numero: 1 })).toBe('vuelo')
    // Un nombre con dos puntos rompería la relectura del grupo.
    expect(grupoDeInstancia(VUELO, { nombre: 'Salida 9:15 a. m.' })).toBe('vuelo: Salida 9 -15 a. m.')
  })
})

describe('siguienteGrupoDeTipo', () => {
  it('la primera va sin etiqueta: una cotización de un vuelo se escribe como hoy', () => {
    expect(siguienteGrupoDeTipo(VUELO, [])).toBe('vuelo')
    expect(siguienteGrupoDeTipo(VUELO, ['hotel', 'seguro'])).toBe('vuelo')
  })

  it('con una del tipo, la siguiente es la 2', () => {
    expect(siguienteGrupoDeTipo(VUELO, ['vuelo', 'hotel'])).toBe('vuelo 2')
    expect(siguienteGrupoDeTipo(VUELO, ['vuelo', 'vuelo 2'])).toBe('vuelo 3')
  })

  it('una primera RENOMBRADA sigue contando: no se reinicia la serie', () => {
    // Devolver «vuelo» aquí crearía una tercera ranura que se lee como si fuera la
    // primera, y el cliente vería dos vuelos donde hay uno.
    expect(siguienteGrupoDeTipo(VUELO, ['vuelo: Bogotá a San Andrés'])).toBe('vuelo 2')
  })

  it('reconoce el sinónimo al contar', () => {
    expect(siguienteGrupoDeTipo(VUELO, ['tiquetes'])).toBe('vuelo 2')
  })
})

// ── El caso de Providencia, entero ───────────────────────────────────────────

/**
 * Vuelo 1 con dos aerolíneas, Vuelo 2 con dos horarios, Hotel con dos.
 * Los dos vuelos suman; dentro de cada uno solo una variante entra.
 */
/** Precio de venta de cada línea, para poder medir el total en plata. */
const PRECIOS: Record<string, number> = {
  v1a: 700_000, v1b: 760_000,
  v2a: 240_000, v2b: 260_000,
  h1: 850_000, h2: 900_000,
  seguro: 120_000,
}

/** Sin administrativos ni descuento: lo que se mide aquí es la SUMA, no la cascada. */
const PARAMS = { administrativosPct: null, margenPct: null, descuentoComercialPct: null }

/** Las mismas líneas, con su precio puesto a mano, para poder medir el total. */
function conPrecios<T extends { id: string }>(items: T[]) {
  return items.map(i => ({
    ...i,
    cantidad: 1,
    precio_venta: PRECIOS[i.id],
    subtotal: PRECIOS[i.id],
    precio_manual: true,
    // El precio se fija a mano, así que la cascada no mira rubros; el campo es
    // obligatorio en `ItemParaCascada` y 0 es lo que tiene una línea sin desglosar.
    numeroDeRubros: 0,
  }))
}

const PROVIDENCIA = [
  { id: 'v1a', grupo: 'vuelo: Bogotá a San Andrés', orden: 1 },
  { id: 'v1b', grupo: 'vuelo: Bogotá a San Andrés', opcion_de: 'v1a', orden: 2 },
  { id: 'v2a', grupo: 'vuelo 2: San Andrés a Providencia', orden: 3 },
  { id: 'v2b', grupo: 'vuelo 2: San Andrés a Providencia', opcion_de: 'v2a', orden: 4 },
  { id: 'h1', grupo: 'hotel', orden: 5 },
  { id: 'h2', grupo: 'hotel', opcion_de: 'h1', orden: 6 },
  { id: 'seguro', grupo: 'seguro', orden: 7 },
]

describe('el viaje a Providencia', () => {
  it('son TRES ranuras que se cruzan, no dos', () => {
    const ranuras = ranurasCombinables(PROVIDENCIA)
    expect(ranuras.map(r => r.grupo)).toEqual([
      'vuelo: Bogotá a San Andrés',
      'vuelo 2: San Andrés a Providencia',
      'hotel',
    ])
    expect(ranuras.map(r => r.candidatos.length)).toEqual([2, 2, 2])
  })

  it('los dos vuelos SUMAN: una tarifa lleva uno de cada ranura', () => {
    const aportan = itemsQueAportanAlTotal(PROVIDENCIA)
    // Un vuelo de cada ranura, un hotel, y el seguro que entra siempre.
    expect(aportan.sort()).toEqual(['h1', 'seguro', 'v1a', 'v2a'])
  })

  it('y suman EN PLATA: el precio de la tarifa lleva los dos tramos', () => {
    const cascada = cascadaDeItinerario(conPrecios(PROVIDENCIA), ['v1a', 'v2b', 'h2'], PARAMS)
    expect(cascada.precioVenta).toBe(700_000 + 260_000 + 900_000 + 120_000)
    expect(cascada.lineas.map(l => l.id)).toContain('v2b')
  })

  it('CONTROL · con los dos tramos en la MISMA ranura, el precio sale corto', () => {
    // El caso de Alejandra, en números: el motor descarta uno de los dos y el cliente
    // recibe un precio sin el tramo a la isla. Es lo que las ranuras múltiples vienen
    // a que se pueda evitar.
    const enUnaSolaRanura = PROVIDENCIA.map(i => ({
      ...i,
      grupo: i.grupo.startsWith('vuelo') ? 'vuelo' : i.grupo,
    }))
    const cascada = cascadaDeItinerario(conPrecios(enUnaSolaRanura), ['v1a', 'h2'], PARAMS)
    expect(cascada.precioVenta).toBe(700_000 + 900_000 + 120_000)
    expect(cascada.lineas.map(l => l.id)).not.toContain('v2a')
  })

  /**
   * ⚠️ Las dos pruebas de arriba pasan IGUAL sin este frente, y conviene decirlo: dos
   * grupos distintos siempre sumaron, resolvieran o no a una ranura del catálogo. Lo que
   * cambia al reconocer «vuelo 2» como vuelo son estas dos cosas, y las dos son las que
   * caen si la resolución se rompe.
   */
  describe('lo que de verdad cambia al reconocer «Vuelo 2» como vuelo', () => {
    it('es una DECISIÓN de la tarifa, no un supuesto: sin elegir, no aporta', () => {
      // Antes «vuelo 2» era un grupo libre: no abría columna y aportaba su primer
      // candidato por supuesto, sin que nadie pudiera elegir el horario por tarifa.
      // Ahora es columna, así que sin elección la tarifa queda incompleta y lo dice.
      const cascada = cascadaDeItinerario(conPrecios(PROVIDENCIA), ['v1a', 'h2'], PARAMS)
      expect(cascada.lineas.map(l => l.id)).not.toContain('v2a')
      expect(ranurasSinResolver(PROVIDENCIA, ['v1a', 'h2']))
        .toEqual(['vuelo 2: San Andrés a Providencia'])
    })

    it('⚠️ nadie puede sacar el segundo vuelo del precio', () => {
      // El hueco que cerraba mal: con «vuelo 2» sin reconocer, `puedeSerSugerido` daba
      // true y alguien podía marcar el tramo a Providencia «fuera del precio». La línea
      // se seguiría imprimiendo y dejaría de sumar — precio incompleto, documento
      // impecable, que es exactamente el error que este frente mata.
      const segundoVuelo = { id: 'v2a', grupo: 'vuelo 2: San Andrés a Providencia', es_ajuste: false }
      expect(puedeSerSugerido(segundoVuelo)).toBe(false)
      expect(puedeLlevarDia(segundoVuelo)).toBe(false)
      // Control: un componente propio sí puede, y por eso el criterio no es «todo lo
      // que tenga grupo».
      expect(puedeSerSugerido({ id: 's', grupo: 'seguro', es_ajuste: false })).toBe(true)
    })
  })

  it('dentro de una ranura, la segunda variante NO suma', () => {
    const aportan = new Set(itemsQueAportanAlTotal(PROVIDENCIA))
    expect(aportan.has('v1b')).toBe(false)
    expect(aportan.has('v2b')).toBe(false)
    expect(aportan.has('h2')).toBe(false)
  })

  it('una tarifa a la que le falta el segundo vuelo lo dice con nombre propio', () => {
    const faltan = ranurasSinResolver(PROVIDENCIA, ['v1a', 'h1'])
    expect(faltan).toEqual(['vuelo 2: San Andrés a Providencia'])
    expect(faltan.map(etiquetaDeRanura)).toEqual(['Vuelo 2 · San Andrés a Providencia'])
  })

  it('una tarifa completa no reclama nada', () => {
    expect(ranurasSinResolver(PROVIDENCIA, ['v1a', 'v2b', 'h2'])).toEqual([])
  })

  it('ANTES del cambio los dos vuelos habrían competido', () => {
    // El control de la prueba de arriba: si los dos tramos se cargan en el MISMO grupo
    // —que es lo único que se podía hacer hasta hoy— el motor descarta uno y el PDF sale
    // sin ese tramo. Es el defecto que este frente cierra.
    const enUnaSolaRanura = PROVIDENCIA.map(i =>
      i.grupo.startsWith('vuelo') ? { ...i, grupo: 'vuelo' } : i,
    )
    const aportan = new Set(itemsQueAportanAlTotal(enUnaSolaRanura))
    expect(aportan.has('v2a')).toBe(false)
  })
})

// ── El aviso de cobertura: dentro de una ranura, no entre ranuras ────────────

/** Una casilla leída, con lo justo para que `leerTarifaPax` la acepte. */
function lectura(identidad: Record<string, string | null>): LecturaCasilla {
  return {
    moneda: 'COP',
    total: 1000,
    aPagarAgencia: null,
    porTipo: [],
    ocupacion: { adultos: null, ninos: null, infantes: null, total: null },
    ocupacionDelItem: false,
    identidad,
    notasCliente: [],
    alertas: [],
    campos: [],
    nombre: 'Línea',
    descripcion: '',
    leidaEn: '2026-09-21T12:00:00Z',
  }
}

function conTrayecto(
  id: string,
  grupo: string,
  nombre: string,
  origen: string,
  destino: string,
  orden: number,
): LineaParaCobertura {
  return {
    id,
    grupo,
    nombre,
    orden,
    tarifa_pax: { casillas: { grupo_completo: lectura({ origen, destino, fecha_regreso: null }) } },
  }
}

describe('cobertura con varias ranuras de vuelo', () => {
  it('NO avisa entre ranuras distintas: cubren tramos distintos a propósito', () => {
    // Éste es el punto que hace utilizable el modelo nuevo: el aviso existe para el
    // error de cargar un tramo COMO OPCIÓN. Dos ranuras son dos tramos declarados, y
    // avisar ahí sería ruido en cada viaje con escala.
    const lineas = [
      conTrayecto('v1', 'vuelo: Bogotá a San Andrés', 'AVIANCA', 'BOG', 'ADZ', 1),
      conTrayecto('v2', 'vuelo 2: San Andrés a Providencia', 'SATENA', 'ADZ', 'PVA', 2),
    ]
    expect(avisosDeCobertura(lineas)).toEqual([])
  })

  it('SÍ avisa dentro de una ranura, y nombra CUÁL', () => {
    const lineas = [
      conTrayecto('v1', 'vuelo: Bogotá a San Andrés', 'AVIANCA', 'BOG', 'ADZ', 1),
      { ...conTrayecto('v1b', 'vuelo: Bogotá a San Andrés', 'SATENA', 'ADZ', 'PVA', 2), opcion_de: 'v1' },
      conTrayecto('v2', 'vuelo 2: San Andrés a Providencia', 'SATENA', 'ADZ', 'PVA', 3),
    ]
    const avisos = avisosDeCobertura(lineas)
    expect(avisos).toHaveLength(1)
    expect(avisos[0].grupo).toBe('vuelo: Bogotá a San Andrés')
    // Con dos ranuras de vuelo, decir solo «las opciones de vuelo» no permite saber en
    // cuál de las dos está el problema.
    expect(avisos[0].texto).toContain('Vuelo · Bogotá a San Andrés')
  })
})
