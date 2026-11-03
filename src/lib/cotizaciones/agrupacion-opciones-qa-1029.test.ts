import { describe, expect, it } from 'vitest'

import { gruposDeVuelos } from '@/lib/pdf/html/trappvel/plantilla'

import { mismoLugar } from './bandeja-capturas'
import { cuerpoDeAceptar, filasDelLote, frasesDeLaBandeja, type CapturaLista } from './bandeja-por-pasos'
import { avisosDeCobertura } from './cobertura-opciones'
import type { Borrador } from './proceso-captura'
import type { FilaVueloDoc, ModeloPropuesta } from './propuesta/modelo-documento'
import type { LecturaCasilla, TipoPasajero } from './tarifa-pasajero'
import { avisosDeTrayectoRepetido } from './trayecto-repetido'
import { ubicarLectura, type LineaParaUbicar } from './ubicar-lectura'

/**
 * G1 · agrupación de opciones (QA de punta a punta de Trappvel, 2026-10-29). Las lecturas son
 * las de producción (COT-2026-0010, 0011, 0014, 0016 y 0017), recortadas a lo que decide dónde
 * va cada captura: la identidad y los campos de ruta o de estadía.
 */

type Campos = Record<string, string>

function lectura(nombre: string, identidad: Record<string, string | null>, campos: Campos, total: number, adultos = 2): LecturaCasilla {
  return {
    nombre,
    identidad,
    campos: Object.entries(campos).map(([label, valor]) => ({ label, valor })),
    moneda: 'COP',
    total,
    porTipo: [{ tipo: 'adulto' as TipoPasajero, cantidad: adultos, subtotal: total }],
    ocupacion: { adultos, ninos: 0, infantes: 0, total: adultos },
  } as unknown as LecturaCasilla
}

function vuelo(aerolinea: string, origen: string, destino: string, salida: string, regreso: string | null, total: number): LecturaCasilla {
  return lectura(
    `${aerolinea} ${origen}–${destino}`,
    { origen, destino, aerolinea, fecha_salida: salida, fecha_regreso: regreso },
    { Aerolínea: aerolinea, Origen: origen, Destino: destino, Salida: salida, ...(regreso ? { Regreso: regreso } : {}) },
    total,
  )
}

function hotel(nombre: string, ciudad: string, total: number): LecturaCasilla {
  return lectura(
    `${nombre} · ${ciudad}`,
    { hotel: nombre, regimen: 'Alojamiento y desayuno', check_in: '2027-03-18', check_out: '2027-03-22', tipo_habitacion: 'Doble' },
    { Hotel: nombre, Ciudad: ciudad, 'Check-in': '2027-03-18', 'Check-out': '2027-03-22', Noches: '4' },
    total,
    4,
  )
}

const SIN_PISTAS: { lugar: string | null; origen: string | null; destino: string | null } = { lugar: null, origen: null, destino: null }

/** Lo que hace el servidor con «Aceptar los N»: cada una contra lo que dejaron las anteriores. */
function aceptarEnOrden(tipo: 'vuelo' | 'hotel', lecturas: LecturaCasilla[], previas: LineaParaUbicar[] = []) {
  let lineas = [...previas]
  let bloques = new Set(previas.map(l => l.grupo)).size
  for (const [i, l] of lecturas.entries()) {
    const d = ubicarLectura({ tipo, lectura: l, pistas: SIN_PISTAS, lineas, grupoViaje: null })
    const grupo = d.como === 'nueva' ? (++bloques === 1 ? tipo : `${tipo} ${bloques}`) : d.como === 'hermana' ? d.grupo : null
    if (grupo) lineas = [...lineas, { id: `l${i}`, grupo, nombre: l.nombre, tarifa_pax: { casillas: { grupo_completo: l } } }]
  }
  return { lineas, bloques: new Set(lineas.map(l => l.grupo)).size }
}

// ── Las lecturas reales ─────────────────────────────────────────────────────

const JETSMART = vuelo('JetSMART', 'Bogotá', 'Cartagena', '2027-02-04', '2027-02-07', 398_600)
const LATAM = vuelo('LATAM', 'Bogotá BOG', 'Cartagena CTG', '2027-02-04', '2027-02-07', 612_800)
const AVIANCA_CTG = vuelo('Avianca', 'Bogotá BOG', 'Cartagena CTG', '2027-02-04', '2027-02-07', 689_400)

const COPA_CUR = vuelo('Copa Airlines', 'Bogotá BOG', 'Curazao CUR', '2027-04-10', '2027-04-16', 3_789_200)
const WINGO_CUR = vuelo('Wingo', 'Bogotá (BOG)', 'Curazao (CUR)', '2027-04-10', '2027-04-16', 2_472_800)
const AVIANCA_CUR = vuelo('Avianca', 'Bogotá BOG', 'Curazao CUR', '2027-04-10', '2027-04-16', 4_210_600)

const AA_MIA = vuelo('American Airlines', 'Miami (MIA)', 'Bogotá (BOG)', '2027-06-29', null, 6_645_200)
const AVIANCA_MIA = vuelo('Avianca', 'Miami (MIA)', 'Bogotá BOG', '2027-06-29', null, 7_193_800)

const ECOHABS = hotel('Ecohahs Tayrona', 'Parque Tayrona', 8_960_000)
const ZUANA = hotel('Zuana Beach Resort', 'Santa Marta · Bello Horizonte', 4_580_000)
const MENDIHUACA = hotel('Mendihuaca Caribbean Resort', 'Mendihuaca', 6_280_000)

// ── 1. La ruta se compara normalizada ───────────────────────────────────────

describe('G1 · un lugar escrito de tres formas es el mismo lugar', () => {
  it('«Bogotá», «Bogotá BOG», «Bogotá (BOG)» y «BOG»', () => {
    expect(mismoLugar('Bogotá', 'Bogotá BOG')).toBe(true)
    expect(mismoLugar('Bogotá (BOG)', 'Bogotá BOG')).toBe(true)
    expect(mismoLugar('Cartagena CTG', 'CTG')).toBe(true)
    expect(mismoLugar('BOGOTÁ BOG', 'Bogotá')).toBe(true)
    expect(mismoLugar('Cartagena de Indias', 'CTG')).toBe(true)
  })

  it('sin abrir la puerta a lo que no es', () => {
    expect(mismoLugar('Cartagena CTG', 'Santa Marta SMR')).toBe(false)
    expect(mismoLugar('Bogotá BOG', 'Cartagena')).toBe(false)
    // EWR no está en la tabla: no se adivina que es Nueva York.
    expect(mismoLugar('Newark EWR', 'Nueva York JFK')).toBe(false)
    // Una ciudad de dos palabras en mayúscula no se vuelve un código («SAN JOSE» no es «JOSE»).
    expect(mismoLugar('SANTA MARTA', 'Santa Marta')).toBe(true)
  })
})

describe('G1 · M1 · los vuelos de la misma ruta y fechas son opciones de UN bloque', () => {
  it('viaje 03: JetSMART «Bogotá → Cartagena» con LATAM y Avianca «BOG → CTG»', () => {
    expect(aceptarEnOrden('vuelo', [JETSMART, LATAM, AVIANCA_CTG]).bloques).toBe(1)
  })

  it('viaje 06: Copa «Bogotá BOG», Wingo «Bogotá (BOG)» y Avianca «Bogotá BOG»', () => {
    expect(aceptarEnOrden('vuelo', [COPA_CUR, WINGO_CUR, AVIANCA_CUR]).bloques).toBe(1)
    expect(aceptarEnOrden('vuelo', [WINGO_CUR, AVIANCA_CUR, COPA_CUR]).bloques).toBe(1)
  })

  it('viaje 07: los dos «Vuelo Miami–Bogotá» (AA y Avianca) van juntos', () => {
    expect(aceptarEnOrden('vuelo', [AA_MIA, AVIANCA_MIA]).bloques).toBe(1)
  })

  it('viaje 07: un bloque con el MISMO rótulo recibe la captura aunque su opción no deje leer la ruta', () => {
    const sinRuta: LineaParaUbicar = { id: 'x', grupo: 'vuelo 3: Vuelo Miami–Bogotá', nombre: 'Opción 1', tarifa_pax: null }
    expect(ubicarLectura({ tipo: 'vuelo', lectura: AVIANCA_MIA, pistas: SIN_PISTAS, lineas: [sinRuta], grupoViaje: null }))
      .toEqual({ como: 'hermana', grupo: 'vuelo 3: Vuelo Miami–Bogotá' })
  })

  it('otro día es otro vuelo, aunque la ruta sea la misma', () => {
    const otroDia = vuelo('Avianca', 'Bogotá BOG', 'Cartagena CTG', '2027-02-10', null, 500_000)
    expect(aceptarEnOrden('vuelo', [JETSMART, otroDia]).bloques).toBe(2)
  })
})

// ── 2. Hoteles: la zona no es la ciudad ─────────────────────────────────────

describe('G1 · M5 · hoteles alternativos para las mismas noches van en UN bloque', () => {
  it('viaje 04: Ecohabs (Parque Tayrona), Zuana (Santa Marta · Bello Horizonte) y Mendihuaca', () => {
    expect(aceptarEnOrden('hotel', [ECOHABS, ZUANA, MENDIHUACA]).bloques).toBe(1)
  })

  it('otras noches siguen siendo otro bloque', () => {
    const despues = lectura('Casa Verde · Minca', { hotel: 'Casa Verde', check_in: '2027-03-22', check_out: '2027-03-24' }, { Hotel: 'Casa Verde', Ciudad: 'Minca', 'Check-in': '2027-03-22', 'Check-out': '2027-03-24' }, 1_000_000, 4)
    expect(aceptarEnOrden('hotel', [ECOHABS, despues]).bloques).toBe(2)
  })
})

// ── 3. La frase de la bandeja dice lo que hará el lote ──────────────────────

const borrador = (tipo: 'vuelo' | 'hotel', l: LecturaCasilla, pistas = SIN_PISTAS): Borrador =>
  ({ tipo, lectura: l, lecturaJson: JSON.stringify(l), firma: 'f', pistas }) as Borrador

describe('G1 · M3 · la bandeja anuncia lo que hace «Aceptar los N»', () => {
  // Como la muestra la bandeja: lo nuevo arriba. Se pegaron Copa, Wingo, Avianca.
  const capturas: CapturaLista[] = [
    { id: 'avianca', titulo: 'Avianca Bogotá BOG–Curazao CUR', borrador: borrador('vuelo', AVIANCA_CUR, { lugar: null, origen: 'Bogotá BOG', destino: 'Curazao CUR' }) },
    { id: 'wingo', titulo: 'Wingo Bogotá (BOG)–Curazao (CUR)', borrador: borrador('vuelo', WINGO_CUR, { lugar: null, origen: 'Bogotá (BOG)', destino: 'Curazao (CUR)' }) },
    { id: 'copa', titulo: 'Copa Airlines Bogotá BOG–Curazao CUR', borrador: borrador('vuelo', COPA_CUR, { lugar: null, origen: 'Bogotá BOG', destino: 'Curazao CUR' }) },
  ]
  const frases = frasesDeLaBandeja({ capturas, lineas: [], composicion: null, destinoViaje: 'Curazao', modelo: () => null, eleccion: () => null })

  it('la primera pegada abre el bloque; las otras dos dicen que son opción de ella', () => {
    expect(frases.get('copa')?.frase).toBe('Suma aparte: Vuelo en Curazao CUR')
    expect(frases.get('wingo')).toMatchObject({ frase: 'Otra opción de: Vuelo en Curazao CUR (en la bandeja)', capturaDestino: 'copa' })
    expect(frases.get('avianca')).toMatchObject({ frase: 'Otra opción de: Vuelo en Curazao CUR (en la bandeja)', capturaDestino: 'copa' })
  })

  it('y el lote las manda así: detrás de Copa, como opciones', () => {
    const filas = filasDelLote(capturas.map(c => ({ id: c.id, borrador: c.borrador, frase: frases.get(c.id)!, estado: null, imagen: null })))
    expect(filas.map(f => [f.id, f.borrador.decision, f.destinoCaptura ?? null])).toEqual([
      ['copa', 'auto', null],
      ['wingo', 'hermana', 'copa'],
      ['avianca', 'hermana', 'copa'],
    ])
  })

  it('hoteles: los tres de Santa Marta, uno abre y dos compiten', () => {
    const hs: CapturaLista[] = [MENDIHUACA, ZUANA, ECOHABS].map((l, i) => ({ id: `h${i}`, titulo: l.nombre as string, borrador: borrador('hotel', l) }))
    const f = frasesDeLaBandeja({ capturas: hs, lineas: [], composicion: null, destinoViaje: 'Santa Marta', modelo: () => null, eleccion: () => null })
    expect(f.get('h2')?.destino.como).toBe('nueva')
    expect(f.get('h1')?.capturaDestino).toBe('h2')
    expect(f.get('h0')?.capturaDestino).toBe('h2')
  })

  it('«Otra habitación de» una fila de la bandeja se acepta como habitación', () => {
    const f = { destino: { como: 'habitacion' as const, itemId: null, grupo: null, razon: null, duda: false, fuente: 'reglas' as const }, frase: 'x', capturaDestino: 'h2' }
    expect(cuerpoDeAceptar(borrador('hotel', ZUANA), f, { imagen: null, correcciones: null, idAceptacion: 'a', destinoId: 'item' })).toMatchObject({ decision: 'habitacion', destinoId: 'item' })
  })
})

// ── 4. El aviso de cobertura no salta por BOG contra Bogotá ─────────────────

describe('G1 · M2 · «las opciones no cubren lo mismo» no salta por cómo se escribió el lugar', () => {
  const linea = (id: string, l: LecturaCasilla) => ({ id, grupo: 'vuelo: Vuelo Bogotá–Cartagena', nombre: l.nombre, tarifa_pax: { casillas: { grupo_completo: l } } })

  it('viaje 03: JetSMART «Bogotá–Cartagena» y Avianca «BOG–CTG» cubren lo mismo', () => {
    const codigo = vuelo('Avianca', 'BOG', 'CTG', '2027-02-04', '2027-02-07', 689_400)
    expect(avisosDeCobertura([linea('a', JETSMART), linea('b', codigo), linea('c', LATAM)])).toEqual([])
  })

  it('un tramo de verdad distinto sigue avisando', () => {
    const otro = vuelo('Satena', 'San Andrés ADZ', 'Providencia PVA', '2027-02-04', null, 300_000)
    expect(avisosDeCobertura([linea('a', JETSMART), linea('b', otro)])).toMatchObject([{ motivo: 'difieren' }])
  })
})

// ── 5. Tren y vuelo del mismo trayecto y día ────────────────────────────────

describe('G1 · M9-1 · el tren y el vuelo París–Roma del mismo día se avisan', () => {
  const tren = lectura('Paris Gare de Lyon -> Roma Termini', { trayecto: 'Paris Gare de Lyon -> Roma Termini', fecha_hora: '2027-07-10' }, { Trayecto: 'Paris Gare de Lyon -> Roma Termini', Vehículo: 'tren', Fecha: '2027-07-10' }, 474.75)
  const airFrance = vuelo('Air France', 'París CDG', 'Roma FCO', '2027-07-10', null, 655)
  const opciones = new Map([
    ['t', { id: 't', grupo: 'traslado: Traslado Paris Gare de Lyon–Roma Termini', nombre: 'Tren', tarifa_pax: { casillas: { grupo_completo: tren } } }],
    ['v', { id: 'v', grupo: 'vuelo 5: Vuelo París–Roma', nombre: 'Air France', tarifa_pax: { casillas: { grupo_completo: airFrance } } }],
  ])
  const servicios = [
    { grupo: 'traslado: Traslado Paris Gare de Lyon–Roma Termini', tipo: 'traslado', nombre: 'Traslado Paris Gare de Lyon–Roma Termini', opciones: ['t'], estado: 'incluido' },
    { grupo: 'vuelo 5: Vuelo París–Roma', tipo: 'vuelo', nombre: 'Vuelo París–Roma', opciones: ['v'], estado: 'incluido' },
  ]

  it('los dos servicios nombran al otro', () => {
    const avisos = avisosDeTrayectoRepetido(servicios, id => opciones.get(id))
    expect(avisos.get('vuelo 5: Vuelo París–Roma')).toMatch(/Traslado Paris Gare de Lyon–Roma Termini/)
    expect(avisos.get('traslado: Traslado Paris Gare de Lyon–Roma Termini')).toMatch(/Vuelo París–Roma/)
  })

  it('si uno ya está en «No va», no hay nada que avisar', () => {
    const avisos = avisosDeTrayectoRepetido([{ ...servicios[0], estado: 'no' }, servicios[1]], id => opciones.get(id))
    expect(avisos.size).toBe(0)
  })
})

// ── 6. Rótulos «Ida / Regreso» del PDF ──────────────────────────────────────

describe('G1 · V4 · el regreso de JetSMART se rotula «Regreso», con los demás', () => {
  const fila = (aerolinea: string, sentido: 'ida' | 'regreso', desde: string, hasta: string, fecha: string): FilaVueloDoc => ({
    sentido, tarifas: [], aerolinea, numero: null, desde, hasta, escala: null, fecha, salida: null, llegada: null,
    tarifaAerolinea: null, equipaje: null, adicionales: [],
  })
  it('viaje 03: «Cartagena → Bogotá» y «CTG → BOG» son un solo grupo «Regreso»', () => {
    const vuelos = [
      fila('JetSMART', 'ida', 'Bogotá', 'Cartagena', '2027-02-04'),
      fila('Avianca', 'ida', 'Bogotá BOG', 'Cartagena CTG', '2027-02-04'),
      fila('JetSMART', 'regreso', 'Cartagena', 'Bogotá', '2027-02-07'),
      fila('Avianca', 'regreso', 'Cartagena CTG', 'Bogotá BOG', '2027-02-07'),
    ]
    const g = gruposDeVuelos(vuelos, { ruta: { origen: 'Bogotá BOG' } } as unknown as ModeloPropuesta)
    expect(g.map(x => [x.titulo, x.filas.length])).toEqual([['Ida', 2], ['Regreso', 2]])
  })
})
