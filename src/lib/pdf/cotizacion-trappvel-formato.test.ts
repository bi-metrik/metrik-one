/**
 * Las reglas de forma del documento de Trappvel (sistema visual del 2026-09-22), sin
 * pintar nada. Lo que el documento IMPRIME lo prueba `cotizacion-trappvel-render.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import {
  ALTO_ENCABEZADO_VUELOS,
  ALTO_MAXIMO_COLUMNA,
  FORMA_DE_FOTO_EN_TERCIO,
  TOKENS,
  absorberRedondeo,
  altoEstimadoDeGrupoDeVuelos,
  altoEstimadoDeLista,
  capitulosDelViaje,
  clienteDeLaPortada,
  colorDeTarifa,
  diaADiaSeImprime,
  disposicionDeListas,
  encuadreDeFoto,
  gruposPorDia,
  leerFecha,
  lugarLegible,
  numerosDeVuelo,
  rangoCompacto,
  renglonesDeFotos,
  siglaAerolinea,
  tablaDeVuelosVaEntera,
  tituloConAcento,
  vueloDesdeNombre,
  yaEstaEnElTitulo,
  yaLoDiceLaPortada,
  type FilaPorPasajeroDoc,
} from './cotizacion-trappvel-formato'
import type { HotelPDF } from '@/lib/cotizaciones/detalle-viaje'

const hotel = (over: Partial<HotelPDF>): HotelPDF => ({
  linea: 'HOTEL',
  hotel: 'Hotel',
  ciudad: 'Madrid',
  habitacion: null,
  regimen: null,
  checkIn: null,
  checkOut: null,
  noches: null,
  ocupacion: null,
  cancelacion: null,
  estrellas: null,
  localizador: null,
  adicionales: [],
  ...over,
})

describe('el color de cada tarifa', () => {
  it('la principal es magenta aunque se llame distinto', () => {
    expect(colorDeTarifa('Económica', true)).toBe(TOKENS.magenta)
  })

  it('económica es verde y premium púrpura, con o sin tilde', () => {
    expect(colorDeTarifa('Económica', false)).toBe(TOKENS.verde)
    expect(colorDeTarifa('ECONOMICA', false)).toBe(TOKENS.verde)
    expect(colorDeTarifa('Premium', false)).toBe(TOKENS.purpura)
  })

  it('un nombre que no se reconoce recibe azul, que no choca con ninguna', () => {
    expect(colorDeTarifa('Plan familiar', false)).toBe(TOKENS.azul)
  })
})

describe('la sigla de la aerolínea', () => {
  it('manda la del número de vuelo, que es un dato leído', () => {
    expect(siglaAerolinea('Aerolínea X', 'AV8520')).toBe('AV')
    expect(siglaAerolinea(null, 'LA 4072')).toBe('LA')
  })

  it('sin número, la del nombre, sin importar tildes ni mayúsculas', () => {
    expect(siglaAerolinea('SATENA', null)).toBe('9R')
    expect(siglaAerolinea('Aeroméxico', null)).toBe('AM')
  })

  it('⚠️ la clave es palabra entera: «tap» no atrapa «Tapachula»', () => {
    expect(siglaAerolinea('Vuelos Tapachula', null)).toBeNull()
  })

  it('sin forma de saberla no se inventa', () => {
    expect(siglaAerolinea('Aerolínea desconocida', null)).toBeNull()
    expect(siglaAerolinea(null, null)).toBeNull()
  })
})

describe('los números de vuelo de la ida y del regreso', () => {
  it('con dos números y regreso, el primero es la ida y el segundo el regreso', () => {
    expect(numerosDeVuelo('AV8520 / AV9380', true)).toEqual({ ida: 'AV8520', regreso: 'AV9380', sinAsignar: null })
  })

  /**
   * ⚠️ COT-2026-0006 (2026-09-22): la lectura de SATENA guardó `8832 · 8833` y el documento
   * imprimió los dos en la fila de la ida, con el regreso sin vuelo. El `·` no era
   * separador, así que el texto no se dejaba partir y caía entero en la ida.
   */
  it('⚠️ COT-2026-0006: «8832 · 8833» y «9782, 9779» se reparten ida y regreso', () => {
    expect(numerosDeVuelo('8832 · 8833', true)).toEqual({ ida: '8832', regreso: '8833', sinAsignar: null })
    expect(numerosDeVuelo('9782, 9779', true)).toEqual({ ida: '9782', regreso: '9779', sinAsignar: null })
  })

  it('con el código de la aerolínea separado por espacio, cada número sigue siendo uno', () => {
    expect(numerosDeVuelo('AV 8520 / AV 9380', true)).toEqual({ ida: 'AV8520', regreso: 'AV9380', sinAsignar: null })
  })

  it('con cuatro tramos, mitad y mitad', () => {
    expect(numerosDeVuelo('AV1 AV2 AV3 AV4', true)).toEqual({ ida: 'AV1 · AV2', regreso: 'AV3 · AV4', sinAsignar: null })
    expect(numerosDeVuelo('9459 · 4867 · 9842 · 9488', true)).toEqual({ ida: '9459 · 4867', regreso: '9842 · 9488', sinAsignar: null })
  })

  it('⚠️ sin forma de saber cuál es de cuál, no se pega a ningún tramo: va sin asignar', () => {
    // Impar: no se sabe dónde parte.
    expect(numerosDeVuelo('AV1 AV2 AV3', true)).toEqual({ ida: null, regreso: null, sinAsignar: 'AV1 · AV2 · AV3' })
    // Uno solo para un viaje de ida y regreso: puede ser de cualquiera de los dos.
    expect(numerosDeVuelo('8832', true)).toEqual({ ida: null, regreso: null, sinAsignar: '8832' })
    // Un texto que no es una lista de números no se parte ni se reescribe.
    expect(numerosDeVuelo('ver reserva', true)).toEqual({ ida: null, regreso: null, sinAsignar: 'ver reserva' })
  })

  it('sin regreso todo es de la ida, y sin dato no hay número', () => {
    expect(numerosDeVuelo('AV8520 AV9380', false)).toEqual({ ida: 'AV8520 · AV9380', regreso: null, sinAsignar: null })
    expect(numerosDeVuelo('', true)).toEqual({ ida: null, regreso: null, sinAsignar: null })
    expect(numerosDeVuelo(null, true)).toEqual({ ida: null, regreso: null, sinAsignar: null })
  })
})

describe('lo que el nombre de la línea dice del vuelo', () => {
  it('«AVIANCA BOG - ADZ»: la aerolínea como se escribió y la ruta en IATA', () => {
    expect(vueloDesdeNombre('AVIANCA BOG - ADZ')).toEqual({ aerolinea: 'AVIANCA', origen: 'BOG', destino: 'ADZ' })
    expect(vueloDesdeNombre('AVIANCA BOG - ADZ (alternativa)')).toEqual({ aerolinea: 'AVIANCA', origen: 'BOG', destino: 'ADZ' })
    expect(vueloDesdeNombre('Copa PTY → BOG')).toEqual({ aerolinea: 'Copa', origen: 'PTY', destino: 'BOG' })
  })

  it('sin dos códigos IATA no hay ruta, y sin ruta no se adivina la aerolínea', () => {
    // «PROVIDENCIA» no es un código: el resto del nombre no es el de una aerolínea.
    expect(vueloDesdeNombre('SATENA ADZ - PROVIDENCIA')).toEqual({ aerolinea: null, origen: null, destino: null })
    // En minúscula no cuenta: «bog-adz» puede ser cualquier cosa.
    expect(vueloDesdeNombre('avianca bog - adz')).toEqual({ aerolinea: null, origen: null, destino: null })
    expect(vueloDesdeNombre(null)).toEqual({ aerolinea: null, origen: null, destino: null })
  })

  it('con ruta pero sin una aerolínea conocida, la ruta sale y la aerolínea no', () => {
    expect(vueloDesdeNombre('TRASLADO APT - HTL')).toEqual({ aerolinea: null, origen: 'APT', destino: 'HTL' })
  })
})

describe('el redondeo del precio por pasajero', () => {
  // COT-2026-0006: 6 adultos a 1.651.969 (el reparto exacto daba 9.911.816), niño e infante.
  const FILAS: FilaPorPasajeroDoc[] = [
    { tipo: 'adulto', cantidad: 6, precioUnitario: 1_651_969 },
    { tipo: 'nino', cantidad: 1, precioUnitario: 1_238_558 },
    { tipo: 'infante', cantidad: 1, precioUnitario: 26_676 },
  ]
  const suma = (f: FilaPorPasajeroDoc[]) => f.reduce((a, x) => a + x.precioUnitario * (x.cantidad ?? 0), 0)

  it('⚠️⚠️ COT-2026-0006: los 2 pesos se absorben y la columna suma el TOTAL', () => {
    const r = absorberRedondeo(FILAS, 2)
    expect(r.residuo).toBe(0)
    expect(suma(r.filas)).toBe(11_177_050)
    // Van a la fila de un solo pasajero con mayor subtotal: el niño. El adulto no se toca
    // porque 2 no se reparte entero entre 6.
    expect(r.filas.map(f => f.precioUnitario)).toEqual([1_651_969, 1_238_560, 26_676])
  })

  it('un residuo que se reparte entero entre los de una fila va a esa fila', () => {
    const r = absorberRedondeo([{ tipo: 'adulto', cantidad: 3, precioUnitario: 100 }, { tipo: 'nino', cantidad: 2, precioUnitario: 50 }], 3)
    expect(r).toEqual({ filas: [{ tipo: 'adulto', cantidad: 3, precioUnitario: 101 }, { tipo: 'nino', cantidad: 2, precioUnitario: 50 }], residuo: 0 })
  })

  it('un residuo negativo también se absorbe', () => {
    const r = absorberRedondeo(FILAS, -2)
    expect(suma(r.filas)).toBe(11_177_050 - 4)
    expect(r.residuo).toBe(0)
  })

  it('si ninguna fila lo absorbe entero, lo devuelve intacto para nombrarlo', () => {
    const filas = [{ tipo: 'adulto' as const, cantidad: 6, precioUnitario: 100 }, { tipo: 'nino' as const, cantidad: 2, precioUnitario: 50 }]
    expect(absorberRedondeo(filas, 1)).toEqual({ filas, residuo: 1 })
  })

  it('sin residuo no toca nada', () => {
    expect(absorberRedondeo(FILAS, 0)).toEqual({ filas: FILAS, residuo: 0 })
  })
})

describe('el cliente bajo el título de la portada', () => {
  it('⚠️ persona natural: contacto y empresa son el mismo nombre y sale UNA vez', () => {
    expect(clienteDeLaPortada('Ligia Sanchez', 'Ligia Sanchez')).toBe('Ligia Sanchez')
    // Sin distinguir tildes, mayúsculas ni espacios de más.
    expect(clienteDeLaPortada('LIGIA  SÁNCHEZ', 'Ligia Sanchez')).toBe('LIGIA  SÁNCHEZ')
  })

  it('con empresa y contacto distintos salen los dos, como siempre', () => {
    expect(clienteDeLaPortada('Ana Pérez', 'Viajes Andinos SAS')).toBe('Ana Pérez · Viajes Andinos SAS')
  })

  it('con uno solo sale ese, y sin ninguno no sale nada', () => {
    expect(clienteDeLaPortada(null, 'Viajes Andinos SAS')).toBe('Viajes Andinos SAS')
    expect(clienteDeLaPortada('Ana Pérez', '  ')).toBe('Ana Pérez')
    expect(clienteDeLaPortada(null, null)).toBeNull()
  })
})

describe('el nombre del capítulo contra el título de la portada', () => {
  it('ya está dicho si el título lo nombra entero, sin importar tildes ni puntuación', () => {
    expect(yaEstaEnElTitulo('San Andrés - Providencia', 'San Andrés - Providencia')).toBe(true)
    expect(yaEstaEnElTitulo('Cancun', 'Viaje a Cancún · familia Sánchez')).toBe(true)
  })

  it('la portada lo dice por el título, el nombre del negocio o la ficha DESTINO', () => {
    // COT-2026-0006 con titular: el título ya no nombra el destino, el negocio sí.
    expect(yaLoDiceLaPortada('San Andrés - Providencia', ['Dos islas, un mismo mar', 'San Andrés - Providencia', null])).toBe(true)
    expect(yaLoDiceLaPortada('Providencia', ['Luna de miel', null, 'Providencia'])).toBe(true)
    expect(yaLoDiceLaPortada('Cartagena', ['Luna de miel', 'Familia Porras', 'Caribe'])).toBe(false)
    expect(yaLoDiceLaPortada(null, ['San Andrés'])).toBe(false)
  })

  it('no lo está si el título no lo nombra, o solo lo contiene dentro de otra palabra', () => {
    expect(yaEstaEnElTitulo('Cartagena', 'Luna de miel Pérez')).toBe(false)
    expect(yaEstaEnElTitulo('Roma', 'Romería en Boyacá')).toBe(false)
    expect(yaEstaEnElTitulo(null, 'San Andrés')).toBe(false)
  })
})

describe('lugares y fechas', () => {
  it('«Bogotá BOG» se imprime «Bogotá (BOG)», y sin código queda el nombre', () => {
    expect(lugarLegible('Bogotá BOG')).toBe('Bogotá (BOG)')
    expect(lugarLegible('Providencia')).toBe('Providencia')
    expect(lugarLegible('  ')).toBeNull()
  })

  it('lee la fecha ISO y la corta de la lectura', () => {
    expect(leerFecha('2027-01-17')).toMatchObject({ dia: 17, mes: 0, anio: 2027 })
    expect(leerFecha('17 ene 2027')).toMatchObject({ dia: 17, mes: 0, anio: 2027 })
    expect(leerFecha('17 ene')).toMatchObject({ dia: 17, mes: 0 })
  })

  it('el rango es corto dentro del mismo mes y completo entre meses', () => {
    expect(rangoCompacto('17 ene 2027', '24 ene 2027')).toBe('17–24 ene')
    expect(rangoCompacto('28 ene 2027', '3 feb 2027')).toBe('28 ene – 3 feb')
  })
})

describe('el título con su acento', () => {
  it('pinta el destino si el título lo nombra, sin reescribir el texto', () => {
    expect(tituloConAcento('Viaje a Providencia - Familia Restrepo', 'Providencia')).toEqual({
      antes: 'Viaje a ',
      acento: 'Providencia',
      despues: ' - Familia Restrepo',
    })
  })

  it('encuentra el destino aunque uno tenga tilde y el otro no', () => {
    expect(tituloConAcento('Luna de miel en Cancún', 'Cancun').acento).toBe('Cancún')
  })

  it('si no lo nombra, la última palabra', () => {
    expect(tituloConAcento('Europa - Familia Restrepo', 'Madrid')).toEqual({
      antes: 'Europa - Familia ',
      acento: 'Restrepo',
      despues: '',
    })
  })
})

describe('los capítulos por ciudad', () => {
  it('un capítulo por ciudad de la tarifa principal, en su orden', () => {
    const caps = capitulosDelViaje(
      [hotel({ hotel: 'A', ciudad: 'Madrid', tarifas: [0] }), hotel({ hotel: 'B', ciudad: 'Roma', tarifas: [0] })],
      0,
      null,
    )
    expect(caps.map(c => c.ciudad)).toEqual(['Madrid', 'Roma'])
  })

  it('el hotel de otra tarifa va al capítulo de su ciudad, como alternativa', () => {
    const caps = capitulosDelViaje(
      [hotel({ hotel: 'A', ciudad: 'Madrid', tarifas: [0] }), hotel({ hotel: 'Barato', ciudad: 'Madrid', tarifas: [1] })],
      0,
      null,
    )
    expect(caps).toHaveLength(1)
    expect(caps[0].hotel?.hotel).toBe('A')
    expect(caps[0].alternativas.map(h => h.hotel)).toEqual(['Barato'])
  })

  it('sin hoteles hay un solo capítulo con el destino del negocio', () => {
    expect(capitulosDelViaje([], null, 'Providencia')).toEqual([{ ciudad: 'Providencia', hotel: null, alternativas: [] }])
  })
})

describe('el encuadre de una foto (objectPosition)', () => {
  /** El marco de la portada: todo el ancho de la página (515,28 pt) por 190 de alto. */
  const PORTADA = 515.28 / 190

  it('sin foco, o sin proporción, va al centro: como antes', () => {
    expect(encuadreDeFoto(null, 1.5, PORTADA)).toBe('50% 50%')
    expect(encuadreDeFoto({ x: 0.3, y: 0.7 }, null, PORTADA)).toBe('50% 50%')
    expect(encuadreDeFoto({ x: 0.3, y: 0.7 }, 0, PORTADA)).toBe('50% 50%')
  })

  it('foto más alta que el marco: se recorta arriba y abajo y manda el foco vertical', () => {
    // El Acuario (1600 × 1199) en la portada: la cabaña está al 72 % del alto.
    // Se ve el 49,2 % del alto; centrar el 0,72 da ancla (0,72 − 0,246) / 0,508 = 93,3 %.
    expect(encuadreDeFoto({ x: 0.3, y: 0.72 }, 1600 / 1199, PORTADA)).toBe('50% 93.3%')
  })

  it('foto más apaisada que el marco: se recorta a los lados y manda el foco horizontal', () => {
    // McBean Lagoon (1600 × 352) en una miniatura 3:2: se ve un tercio del ancho, y las
    // montañas están al 65 %.
    expect(encuadreDeFoto({ x: 0.65, y: 0.5 }, 1600 / 352, 1.5)).toBe('72.4% 50%')
  })

  it('un foco pegado al borde deja el ancla en el borde, sin hueco', () => {
    // En 3:2 el Acuario pierde solo el 11 % del alto: la cabaña no se puede centrar, se
    // muestra todo lo de abajo.
    expect(encuadreDeFoto({ x: 0.3, y: 0.72 }, 1600 / 1199, 1.5)).toBe('50% 100%')
    expect(encuadreDeFoto({ x: 0.3, y: 0.02 }, 1600 / 1199, 1.5)).toBe('50% 0%')
  })

  it('con la misma proporción no hay nada que recortar', () => {
    expect(encuadreDeFoto({ x: 0.1, y: 0.9 }, 1.5, 1.5)).toBe('50% 50%')
  })

  it('⚠️ el foco queda en el CENTRO de lo que se ve, en cualquier marco donde quepa', () => {
    // react-pdf desplaza la foto (marco − foto) × ancla, igual que CSS. Se recalcula la
    // franja visible con ese desplazamiento y su centro tiene que ser el foco.
    for (const [foto, marco, f] of [[1.333, 2.71, 0.4], [1.589, 2.71, 0.45], [4.545, 1.5, 0.6], [2.947, 1.5, 0.35]] as const) {
      const pos = encuadreDeFoto({ x: f, y: f }, foto, marco).split(' ').map(v => parseFloat(v) / 100)
      const horizontal = foto > marco
      const visible = horizontal ? marco / foto : foto / marco
      const ancla = horizontal ? pos[0] : pos[1]
      const inicio = ancla * (1 - visible)
      expect(inicio + visible / 2).toBeCloseTo(f, 2)
    }
  })
})

describe('el día a día', () => {
  const vuelo = { esVuelo: true }
  const actividad = { esVuelo: false }

  it('⚠️ si todo son vuelos no se imprime: repetiría la tabla de «Vuelos»', () => {
    expect(diaADiaSeImprime([vuelo, vuelo, vuelo, vuelo])).toBe(false)
    expect(diaADiaSeImprime([])).toBe(false)
  })

  it('con un solo día que no sea vuelo se imprime, con los vuelos en su día', () => {
    expect(diaADiaSeImprime([vuelo, actividad, vuelo])).toBe(true)
  })

  const f = (dia: number) => ({ dia, mes: 4, anio: 2027 })
  const e = (nombre: string, fecha: ReturnType<typeof f> | null, dia: number | null = null) => ({ nombre, fecha, dia })

  it('el vuelo que llega y la actividad de esa tarde son UN día: un bloque, un círculo', () => {
    const grupos = gruposPorDia([e('vuelo', f(13)), e('traslado', f(13)), e('coliseo', f(14))])
    expect(grupos.map(g => g.map(x => x.nombre))).toEqual([['vuelo', 'traslado'], ['coliseo']])
  })

  it('sin fechas agrupa por el día relativo', () => {
    const grupos = gruposPorDia([e('a', null, 1), e('b', null, 1), e('c', null, 3)])
    expect(grupos.map(g => g.map(x => x.nombre))).toEqual([['a', 'b'], ['c']])
  })

  it('una entrada sin fecha ni día va sola, y una con fecha no se junta con una sin ella', () => {
    const grupos = gruposPorDia([e('a', null), e('b', null), e('c', f(13), 1), e('d', null, 1)])
    expect(grupos.map(g => g.map(x => x.nombre))).toEqual([['a'], ['b'], ['c'], ['d']])
  })
})

describe('«Incluido», «A tener en cuenta» y «Antes de viajar»', () => {
  const ANCHO = 515.28
  // El texto de COT-2026-0006 tal como está en producción (2026-09-23).
  const INCLUYE_0006 = [
    'Tiquetes aéreos Bogotá – San Andrés – Bogotá con Avianca, con equipaje de mano y de bodega',
    'Tiquetes aéreos San Andrés – Providencia – San Andrés con SATENA, con artículo personal y equipaje de bodega',
  ]
  const ANTES_0006 = [
    'Asegúrese de llevar su documento de identidad original (cédula de ciudadanía o pasaporte) para todos los viajeros, incluyendo menores',
    'Recuerde llegar con suficiente anticipación al aeropuerto para sus vuelos nacionales, especialmente en temporada alta',
    'El clima en San Andrés y Providencia es tropical, con temperaturas cálidas y humedad. Empaque ropa ligera y cómoda, traje de baño y protector solar',
    'Para ingresar a San Andrés es necesario adquirir la tarjeta de turismo Ocard, un impuesto que se paga directamente en el destino',
  ]

  it('COT-2026-0006: «Incluido» y «Antes de viajar» van lado a lado', () => {
    expect(disposicionDeListas({ incluye: INCLUYE_0006, noIncluye: [], antes: ANTES_0006 }, ANCHO))
      .toEqual([[['incluye'], ['antes']]])
  })

  it('con las tres cortas, lo que incluye y lo que no van juntos a la izquierda', () => {
    expect(disposicionDeListas({ incluye: ['Vuelos'], noIncluye: ['Tasa turística'], antes: ['Pasaporte vigente'] }, ANCHO))
      .toEqual([[['incluye', 'noIncluye'], ['antes']]])
  })

  it('si una columna es larga, «Antes de viajar» baja a todo el ancho', () => {
    const larga = Array.from({ length: 12 }, (_, i) => `Consejo número ${i} con suficiente texto para ocupar un renglón entero en la columna`)
    expect(disposicionDeListas({ incluye: INCLUYE_0006, noIncluye: [], antes: larga }, ANCHO))
      .toEqual([[['incluye']], [['antes']]])
    expect(disposicionDeListas({ incluye: INCLUYE_0006, noIncluye: ['Tasa turística'], antes: larga }, ANCHO))
      .toEqual([[['incluye'], ['noIncluye']], [['antes']]])
  })

  it('sin «Antes de viajar», «Incluido» y «A tener en cuenta» lado a lado, como siempre', () => {
    expect(disposicionDeListas({ incluye: ['Vuelos'], noIncluye: ['Tasa turística'], antes: [] }, ANCHO))
      .toEqual([[['incluye'], ['noIncluye']]])
  })

  it('una lista sola va sola, y sin listas no hay filas', () => {
    expect(disposicionDeListas({ incluye: [], noIncluye: [], antes: ['Pasaporte vigente'] }, ANCHO)).toEqual([[['antes']]])
    expect(disposicionDeListas({ incluye: [], noIncluye: [], antes: [] }, ANCHO)).toEqual([])
  })

  it('el alto estimado crece con el texto y el tope cabe en un tercio de página', () => {
    expect(altoEstimadoDeLista([], 250)).toBe(0)
    expect(altoEstimadoDeLista(['corto'], 250)).toBeLessThan(altoEstimadoDeLista(['x'.repeat(200)], 250))
    // A4 con los márgenes del documento deja ~736 pt de contenido por página.
    expect(ALTO_MAXIMO_COLUMNA).toBeLessThanOrEqual(736 / 2.5)
  })
})

describe('la franja de fotos de la portada', () => {
  const ANCHO_CONTENIDO = 515.28
  const CANAL = 8
  const reparto = (n: number) => renglonesDeFotos(n, ANCHO_CONTENIDO, CANAL).map(r => r.fotos)

  it('sin fotos no hay renglones', () => {
    expect(renglonesDeFotos(0, ANCHO_CONTENIDO, CANAL)).toEqual([])
  })

  it('hasta tres fotos van en un renglón; de ahí en adelante, repartidas sin dejar una sola', () => {
    expect(reparto(1)).toEqual([1])
    expect(reparto(2)).toEqual([2])
    expect(reparto(3)).toEqual([3])
    expect(reparto(4)).toEqual([2, 2])
    expect(reparto(5)).toEqual([3, 2])
    expect(reparto(6)).toEqual([3, 3])
    expect(reparto(7)).toEqual([3, 2, 2])
  })

  it('⚠️ todo renglón llena el ancho del contenido: con dos fotos, dos mitades y no dos tercios', () => {
    for (let n = 1; n <= 7; n += 1) {
      for (const r of renglonesDeFotos(n, ANCHO_CONTENIDO, CANAL)) {
        expect(r.fotos * r.ancho + CANAL * (r.fotos - 1)).toBeCloseTo(ANCHO_CONTENIDO, 6)
      }
    }
    // COT-2026-0006: dos fotos secundarias. Antes cada una medía un tercio y quedaba un hueco.
    const [dos] = renglonesDeFotos(2, ANCHO_CONTENIDO, CANAL)
    expect(dos.ancho).toBeCloseTo((ANCHO_CONTENIDO - CANAL) / 2, 6)
    expect(dos.ancho).toBeGreaterThan((ANCHO_CONTENIDO - 2 * CANAL) / 3)
  })

  it('cada renglón toma sus fotos en orden, sin saltarse ni repetir ninguna', () => {
    const rs = renglonesDeFotos(7, ANCHO_CONTENIDO, CANAL)
    expect(rs.map(r => r.desde)).toEqual([0, 3, 5])
    expect(rs.reduce((a, r) => a + r.fotos, 0)).toBe(7)
  })

  it('todo renglón mide de alto lo que el de tres en 3:2: menos fotos, más anchas, no más altas', () => {
    const tercio = renglonesDeFotos(3, ANCHO_CONTENIDO, CANAL)[0]
    expect(tercio.ancho / tercio.alto).toBeCloseTo(FORMA_DE_FOTO_EN_TERCIO, 6)
    for (let n = 1; n <= 7; n += 1) {
      for (const r of renglonesDeFotos(n, ANCHO_CONTENIDO, CANAL)) expect(r.alto).toBeCloseTo(tercio.alto, 6)
    }
    // Una sola foto es una tira baja, no una segunda portada.
    const [una] = renglonesDeFotos(1, ANCHO_CONTENIDO, CANAL)
    expect(una.ancho / una.alto).toBeGreaterThan(4)
  })
})

describe('la tabla de vuelos, entera o partida con su encabezado', () => {
  const ANCHO_META = 515.28 - 16
  const ida = { conEscala: false, conTarifa: false }
  const conEscala = { conEscala: true, conTarifa: false }
  const nota = 'Tarifa Basic · 1 artículo personal'

  it('calibrado contra el render: un tramo con escala y nota, 43 pt; ida y regreso, 67', () => {
    expect(altoEstimadoDeGrupoDeVuelos({ filas: [conEscala], meta: nota }, ANCHO_META)).toBeCloseTo(43, 0)
    expect(altoEstimadoDeGrupoDeVuelos({ filas: [conEscala, conEscala], meta: nota }, ANCHO_META)).toBeCloseTo(67, 0)
  })

  it('una fila nunca mide menos que la píldora de la sigla', () => {
    const sola = altoEstimadoDeGrupoDeVuelos({ filas: [ida], meta: '' }, ANCHO_META)
    expect(sola).toBe(12 + 14)
  })

  it('la marca de la tarifa, la escala y una nota larga lo hacen crecer', () => {
    const base = altoEstimadoDeGrupoDeVuelos({ filas: [conEscala], meta: nota }, ANCHO_META)
    expect(altoEstimadoDeGrupoDeVuelos({ filas: [{ conEscala: true, conTarifa: true }], meta: nota }, ANCHO_META)).toBeGreaterThan(base)
    expect(altoEstimadoDeGrupoDeVuelos({ filas: [conEscala], meta: nota.repeat(8) }, ANCHO_META)).toBeGreaterThan(base)
    expect(altoEstimadoDeGrupoDeVuelos({ filas: [conEscala], meta: '' }, ANCHO_META)).toBeLessThan(base)
  })

  it('COT-2026-0006 (dos aerolíneas de ida y regreso) va entera: Avianca y SATENA juntas', () => {
    const grupo = altoEstimadoDeGrupoDeVuelos({ filas: [conEscala, conEscala], meta: nota }, ANCHO_META)
    expect(tablaDeVuelosVaEntera([grupo, grupo])).toBe(true)
  })

  it('una tabla larga se parte: ir entera dejaría más de un tercio de hoja en blanco', () => {
    const grupo = altoEstimadoDeGrupoDeVuelos({ filas: [conEscala, conEscala], meta: nota }, ANCHO_META)
    expect(tablaDeVuelosVaEntera(Array(6).fill(grupo))).toBe(false)
  })

  it('el borde es el de las listas del cierre, con título y encabezado incluidos', () => {
    const resto = ALTO_MAXIMO_COLUMNA - 60 - ALTO_ENCABEZADO_VUELOS
    expect(tablaDeVuelosVaEntera([resto])).toBe(true)
    expect(tablaDeVuelosVaEntera([resto + 0.5])).toBe(false)
  })
})
