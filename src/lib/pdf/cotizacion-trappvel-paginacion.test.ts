/**
 * Espacio y paginación del documento de Trappvel (§4.11 del sistema visual, Ren, 2026-10-08).
 *
 * Lo que se afirma aquí se lee del PDF YA RENDERIZADO (`medirPDF`): dónde terminó cada hoja,
 * en qué hoja cayó cada título, qué tamaño de letra se pintó. Las reglas puras (umbrales,
 * qué sección se compacta) se prueban sin renderizar.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { Document, Page, View, renderToBuffer } from '@react-pdf/renderer'
import { crc32, deflateSync } from 'node:zlib'

import CotizacionTrappvelPDF from './cotizacion-trappvel-pdf'
import { componerCotizacionTrappvel, medidaDeHojas, type Renderizador } from './cotizacion-trappvel-paginacion'
import {
  ALTO_UTIL,
  ESCALA_DE_ESPACIOS,
  ESPACIADO_COMPACTO,
  ESPACIADO_NORMAL,
  HOJA,
  espaciadoDe,
  hojasConHueco,
  numeroDeSeccion,
  ocupacionDeHoja,
  recomposicionCumple,
  seccionDeNumero,
  seccionesParaCerrarHueco,
  ultimaHojaTrabaja,
  type Composicion,
  type MedidaDeHojas,
} from './cotizacion-trappvel-formato'
import { colorDeMarca, medirPDF } from './medir-pdf'
import { textoDelPDF } from './texto-del-pdf'
import type { CotizacionPDFProps, ViajePDF } from './cotizacion-props'
import type { HotelPDF, VueloPDF } from '@/lib/cotizaciones/detalle-viaje'
import { TERMINOS_BASE_TRAPPVEL } from '@/lib/cotizaciones/__fixtures__/terminos-base-trappvel'

const FRANJA = { arriba: HOJA.arriba - 8, abajo: HOJA.alto - HOJA.altoPie - 1 }

/** Un PNG de 3 × 2 px de un color: cada foto la suya, para que el PDF no las reutilice. */
function PNG_1x1(r: number): Uint8Array {
  const trozo = (tipo: string, datos: Buffer) => {
    const largo = Buffer.alloc(4)
    largo.writeUInt32BE(datos.length)
    const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(cuerpo))
    return Buffer.concat([largo, cuerpo, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(3, 0)
  ihdr.writeUInt32BE(2, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const fila = Buffer.from([0, r, 90, 140, r, 90, 140, r, 90, 140])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(Buffer.concat([fila, fila]))),
    trozo('IEND', Buffer.alloc(0)),
  ])
}

// ── Datos inventados ──────────────────────────────────────────────────────────

const item = (nombre: string, precio: number, descripcion: string | null = null) => ({ nombre, descripcion, precio_venta: precio, descuento_porcentaje: 0, cantidad: 1, unidad: null })

const hotel = (o: Partial<HotelPDF> & { hotel: string; ciudad: string }): HotelPDF => ({
  linea: o.hotel.toUpperCase(), habitacion: 'Estándar doble', regimen: 'Todo incluido', checkIn: null, checkOut: null, noches: null,
  ocupacion: '2 adultos y 1 niño', cancelacion: null, estrellas: null, localizador: null, adicionales: [], ...o,
})

const vuelo = (n: number): VueloPDF => ({
  linea: `VUELO ${n}`, aerolinea: 'Avianca', origen: 'Bogotá BOG', destino: 'Cartagena CTG',
  fechaSalida: `${n} jun 2027`, fechaRegreso: `${n + 10} jun 2027`, horaSalida: '06:10', horaLlegada: '07:35',
  horaSalidaRegreso: '19:20', horaLlegadaRegreso: '20:45', escalaIda: null, escalaRegreso: null, escalas: 0,
  tarifa: `Tarifa ${String(n).padStart(2, '0')}X`, equipaje: 'Maleta de 23 kg', adicionales: [],
  numeroVuelo: `QA${String(n).padStart(2, '0')}1, QA${String(n).padStart(2, '0')}2`,
} as VueloPDF)

const viaje = (over: Partial<ViajePDF> = {}): ViajePDF => ({
  viajeros: '2 adultos y 1 niño', destino: 'Cartagena', fechas: '12 ene 2027 - 16 ene 2027', duracion: '5 días / 4 noches',
  presentacion: 'Cartagena reúne la ciudad amurallada, las islas del Rosario y una cocina caribeña que vale el viaje.',
  foto: null, vuelos: [vuelo(1)],
  hoteles: [hotel({ hotel: 'Hotel Casa del Puerto', ciudad: 'Cartagena', checkIn: '12 ene 2027', checkOut: '16 ene 2027', noches: 4 })],
  cargosEnDestino: [{ ciudad: 'Cartagena', concepto: 'Impuesto de ingreso a las islas', monto: '28.000 COP', observacion: 'Se paga en el muelle.' }],
  nivelDetalle: 'normal', pie: 'www.trappvel.com · Bogotá',
  firma: { nombre: 'Edgar Javier Alarcón S.', cargo: 'Director Comercial', contacto: 'contacto@trappvel.com' },
  incluye: ['Tiquetes con maleta de 23 kg', 'Cuatro noches con desayuno'],
  antesDeViajar: ['Documento de identidad original'],
  ...over,
})

const props = (over: Partial<CotizacionPDFProps> = {}, v: Partial<ViajePDF> = {}): CotizacionPDFProps => ({
  cotizacion: {
    consecutivo: 'COT-QA-PAG', descripcion: null, valor_total: 0, modo: 'detallada', fecha_envio: null, fecha_validez: null,
    condiciones_pago: null, notas: null, descuento_porcentaje: 0, descuento_valor: 0, terminos_condiciones: TERMINOS_BASE_TRAPPVEL,
  },
  empresa: { nombre: 'Familia Quintero', nit: null, contacto_nombre: 'Laura Quintero', contacto_email: null, telefono: null, direccion: null, ciudad: null },
  vendedor: { nombre: 'Trappvel', razon_social: null, nit: null, logo_url: null, color_primario: '#e63380', telefono: null, email: null, direccion: null, ciudad: null },
  items: [item('TIQUETES AÉREOS', 2_150_000), item('HOTEL CASA DEL PUERTO', 3_420_000)],
  dias: [
    { dia: 1, items: [item('Traslado aeropuerto – hotel', 0)] },
    { dia: 3, items: [item('Islas del Rosario', 0, 'Día completo con almuerzo')] },
  ],
  itemsSinDia: null,
  sugeridos: [{ nombre: 'Atardecer en velero', descripcion: 'Dos horas por la bahía', precio_venta: 180_000, cantidad: 1, unidad: 'pax' }],
  preciosPorPasajero: null,
  fiscal: null,
  negocio: { nombre: 'Viaje a Cartagena' },
  emisor: null,
  viaje: viaje(v),
  ...over,
})

/** Corre el documento hacia el pie con `k` renglones de introducción. */
const corrido = (p: CotizacionPDFProps, k: number): CotizacionPDFProps => ({
  ...p,
  viaje: { ...p.viaje!, intro: 'Un renglón más de introducción para correr el documento hacia el pie de la hoja. '.repeat(k) },
})

const renderNivel = async (p: CotizacionPDFProps, composicion: Composicion) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Buffer.from(await renderToBuffer(createElement(CotizacionTrappvelPDF, { ...p, composicion }) as any))

const TITULOS = ['Día a día', 'Vuelos', 'Inversión', 'Incluido en el plan', 'A tener en cuenta', 'Antes de viajar', 'Opcionales', 'Cargos a pagar en destino', 'Información importante', 'Términos y condiciones']

// ── Reglas puras ──────────────────────────────────────────────────────────────

describe('§4.11 · la escala de espacios', () => {
  it('normal y compacto solo usan valores de la escala 4 · 8 · 12 · 16 · 24 · 32 · 48', () => {
    for (const e of [ESPACIADO_NORMAL, ESPACIADO_COMPACTO]) {
      for (const v of Object.values(e)) expect(ESCALA_DE_ESPACIOS).toContain(v)
    }
  })

  it('la tabla del punto 2: dentro de la tarjeta igual; tarjetas 12→8, bloque 16→12, sección 32→24, capítulo 48→32', () => {
    expect(ESPACIADO_NORMAL).toEqual({ fino: 4, dentro: 8, tarjetas: 12, bloque: 16, seccion: 32, capitulo: 48 })
    expect(ESPACIADO_COMPACTO).toEqual({ fino: 4, dentro: 8, tarjetas: 8, bloque: 12, seccion: 24, capitulo: 32 })
  })

  it('el compacto aplica a todo con el paso 1, y solo a las secciones elegidas con el punto 8', () => {
    expect(espaciadoDe(undefined, 'vuelos')).toBe(ESPACIADO_NORMAL)
    expect(espaciadoDe({ nivel: 1 }, 'vuelos')).toBe(ESPACIADO_COMPACTO)
    expect(espaciadoDe({ nivel: 0, compactas: ['vuelos'] }, 'vuelos')).toBe(ESPACIADO_COMPACTO)
    expect(espaciadoDe({ nivel: 0, compactas: ['vuelos'] }, 'inversion')).toBe(ESPACIADO_NORMAL)
  })

  it('las marcas de sección van en el orden del documento y vuelven a su nombre', () => {
    const orden = ['portada', 'capitulo-0', 'capitulo-1', 'dias', 'vuelos', 'inversion', 'porPasajero', 'listas', 'opcionales', 'cargos', 'notas', 'terminos', 'cierre']
    const numeros = orden.map(numeroDeSeccion)
    expect([...numeros].sort((a, b) => a - b)).toEqual(numeros)
    for (const s of orden) expect(seccionDeNumero(numeroDeSeccion(s))).toBe(s)
  })
})

describe('§4.11 · umbrales de la última hoja y del hueco al pie', () => {
  const fondo = (ocupacion: number) => HOJA.arriba + ocupacion * ALTO_UTIL
  const m = (ocupaciones: number[], inicios: [string, number][] = []): MedidaDeHojas => ({ fondos: ocupaciones.map(fondo), inicios: new Map(inicios) })

  it('la última hoja trabaja desde el 35 %; con una sola hoja trabaja siempre', () => {
    expect(ultimaHojaTrabaja(m([1, 0.35]))).toBe(true)
    expect(ultimaHojaTrabaja(m([1, 0.34]))).toBe(false)
    expect(ultimaHojaTrabaja(m([0.1]))).toBe(true)
    expect(ocupacionDeHoja(fondo(0.5))).toBeCloseTo(0.5, 5)
  })

  it('la recomposición cumple si la última hoja desaparece o pasa del 35 %', () => {
    expect(recomposicionCumple(m([1, 1, 0.2]), m([1, 1]))).toBe(true)
    expect(recomposicionCumple(m([1, 1, 0.2]), m([1, 1, 0.4]))).toBe(true)
    expect(recomposicionCumple(m([1, 1, 0.2]), m([1, 1, 0.1]))).toBe(false)
  })

  it('un blanco al pie mayor que el 25 % es hueco; la última hoja no cuenta', () => {
    expect(hojasConHueco(m([0.74, 0.76, 0.1]))).toEqual([1])
    expect(hojasConHueco(m([0.9, 0.9, 0.1]))).toEqual([])
  })

  it('para un hueco en la hoja 2 se compactan las secciones de esa hoja y la que empieza en la 3', () => {
    const medida = m([1, 0.6, 1, 0.5], [['portada', 1], ['capitulo-0', 1], ['vuelos', 2], ['inversion', 2], ['listas', 3], ['cierre', 4]])
    expect(seccionesParaCerrarHueco(medida, 2)).toEqual(['capitulo-0', 'vuelos', 'inversion', 'listas'])
  })
})

// ── La medición sobre el PDF renderizado ─────────────────────────────────────

/** Un PDF de mentira: cada hoja con un bloque que termina donde se pide y, si se pide, marcas. */
async function pdfDeMentira(fondos: number[], marcas: [string, number][] = []): Promise<Buffer> {
  const hojas = fondos.map((f, i) => createElement(Page, { key: i, size: 'A4', style: { paddingTop: HOJA.arriba } },
    createElement(View, { style: { height: f - HOJA.arriba, backgroundColor: '#E6E4EE', position: 'relative' } },
      ...marcas.filter(([, h]) => h === i + 1).map(([s], j) => createElement(View, {
        key: j, style: { position: 'absolute', top: 0, left: 0, width: 0.5, height: 0.5, backgroundColor: colorDeMarca(numeroDeSeccion(s)) },
      })))))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Buffer.from(await renderToBuffer(createElement(Document, null, ...hojas) as any))
}

describe('§4.11 punto 6 · la medición se hace sobre el PDF ya renderizado', () => {
  it('lee, en el orden de las hojas, dónde termina el contenido de cada una y dónde cayó cada marca', async () => {
    const pdf = await pdfDeMentira([700, 300, 450], [['portada', 1], ['vuelos', 2], ['cierre', 3]])
    const m = medirPDF(pdf, FRANJA)
    expect(m.hojas.map(h => Math.round(h.fondo ?? 0))).toEqual([700, 300, 450])
    expect(m.marcas.get(numeroDeSeccion('vuelos'))).toEqual({ hoja: 2, y: expect.closeTo(HOJA.arriba, 0) })
    expect(medidaDeHojas(pdf).inicios).toEqual(new Map([['portada', 1], ['vuelos', 2], ['cierre', 3]]))
  })

  it('con el documento real: el pie y el logo no cuentan, y el fondo es el del último elemento', async () => {
    const m = medirPDF(await renderNivel(props(), { nivel: 0 }), FRANJA)
    for (const h of m.hojas) {
      expect(h.primero!).toBeGreaterThanOrEqual(FRANJA.arriba)
      // §4.11 punto 1: el contenido nunca invade la franja de 16 pt sobre el pie.
      expect(h.fondo!).toBeLessThanOrEqual(HOJA.alto - HOJA.altoPie - HOJA.franjaSobrePie + 0.5)
    }
    // La firma es lo último del documento.
    const ultima = m.hojas[m.hojas.length - 1]
    const firma = ultima.textos.find(t => t.texto.startsWith('contacto@trappvel'))!
    expect(ultima.fondo! - firma.y).toBeLessThan(4)
  })
})

// ── El paso de composición, con PDFs de mentira ──────────────────────────────

/** Un renderizador que devuelve, por nivel, el PDF de mentira que se le diga, y anota lo que le pidieron. */
function guion(porComposicion: (c: Composicion) => { fondos: number[]; marcas?: [string, number][] }) {
  const pedidas: Composicion[] = []
  const renderizar: Renderizador = async p => {
    pedidas.push(p.composicion)
    const r = porComposicion(p.composicion)
    return pdfDeMentira(r.fondos, r.marcas)
  }
  return { pedidas, renderizar }
}

const LLENA = HOJA.arriba + ALTO_UTIL - 4
const al = (ocupacion: number) => HOJA.arriba + ocupacion * ALTO_UTIL

describe('§4.11 punto 6 · «la última hoja trabaja»', () => {
  it('última hoja al 35 % o más: un solo render y nada se compacta', async () => {
    const g = guion(() => ({ fondos: [LLENA, al(0.4)] }))
    const { informe } = await componerCotizacionTrappvel(props(), g.renderizar)
    expect(g.pedidas).toEqual([{ nivel: 0 }])
    expect(informe).toMatchObject({ renders: 1, composicion: { nivel: 0 }, motivo: 'ninguno' })
  })

  it('con una sola hoja no hay hoja que desaparecer: un solo render, aunque ocupe poco', async () => {
    const g = guion(() => ({ fondos: [al(0.1)] }))
    await componerCotizacionTrappvel(props(), g.renderizar)
    expect(g.pedidas).toEqual([{ nivel: 0 }])
  })

  it('por debajo del 35 % aplica los pasos EN ORDEN y para en cuanto la hoja desaparece', async () => {
    const g = guion(c => ({ fondos: c.nivel >= 2 ? [LLENA, LLENA] : [LLENA, LLENA, al(0.2)] }))
    const { informe } = await componerCotizacionTrappvel(props(), g.renderizar)
    expect(g.pedidas.map(c => c.nivel)).toEqual([0, 1, 2])
    expect(informe).toMatchObject({ renders: 3, composicion: { nivel: 2 }, motivo: 'ultima-hoja', descartado: false })
    expect(informe.despues.hojas).toBe(2)
  })

  it('para también si la última hoja pasa del 35 % sin desaparecer', async () => {
    const g = guion(c => ({ fondos: [LLENA, c.nivel === 0 ? al(0.2) : al(0.5)] }))
    const { informe } = await componerCotizacionTrappvel(props(), g.renderizar)
    expect(g.pedidas.map(c => c.nivel)).toEqual([0, 1])
    expect(informe.composicion).toEqual({ nivel: 1 })
  })

  it('⚠️ nunca más de 4 renders; si los tres pasos no bastan, se acepta la hoja con la composición normal', async () => {
    const g = guion(() => ({ fondos: [LLENA, al(0.2)] }))
    const { informe } = await componerCotizacionTrappvel(props(), g.renderizar)
    expect(g.pedidas.map(c => c.nivel)).toEqual([0, 1, 2, 3])
    expect(informe).toMatchObject({ renders: 4, composicion: { nivel: 0 }, descartado: true })
  })
})

describe('§4.11 punto 8 · hueco al pie por un salto', () => {
  const marcas: [string, number][] = [['portada', 1], ['capitulo-0', 1], ['vuelos', 2], ['inversion', 3], ['cierre', 3]]

  it('un blanco > 25 % compone en compacto lo de esa hoja y la sección que saltó; si así entra, se queda', async () => {
    const g = guion(c => ({ fondos: c.compactas ? [LLENA, LLENA, al(0.6)] : [al(0.6), LLENA, al(0.7)], marcas }))
    const { informe } = await componerCotizacionTrappvel(props(), g.renderizar)
    expect(g.pedidas).toEqual([{ nivel: 0 }, { nivel: 0, compactas: ['portada', 'capitulo-0', 'vuelos'] }])
    expect(informe).toMatchObject({ motivo: 'hueco-al-pie', descartado: false, huecos: [] })
  })

  it('si en compacto tampoco entra, se acepta el hueco y sale la composición normal', async () => {
    const g = guion(() => ({ fondos: [al(0.6), LLENA, al(0.7)], marcas }))
    const { informe } = await componerCotizacionTrappvel(props(), g.renderizar)
    expect(g.pedidas).toHaveLength(2)
    expect(informe).toMatchObject({ composicion: { nivel: 0 }, motivo: 'hueco-al-pie', descartado: true, huecos: [1] })
  })

  it('un blanco del 25 % o menos se acepta sin recomponer', async () => {
    const g = guion(() => ({ fondos: [al(0.8), LLENA, al(0.7)], marcas }))
    await componerCotizacionTrappvel(props(), g.renderizar)
    expect(g.pedidas).toHaveLength(1)
  })
})

// ── Con el documento real ─────────────────────────────────────────────────────

/** Las hojas del PDF real, medidas. */
const hojasDe = (pdf: Buffer) => medirPDF(pdf, FRANJA).hojas

describe('§4.11 con el documento real', () => {
  it('punto 4 · ningún título queda solo al pie: siempre lleva contenido debajo en su misma hoja', async () => {
    for (let k = 0; k <= 30; k += 1) {
      const pdf = await renderNivel(corrido(props(), k), { nivel: k % 4 as Composicion['nivel'] })
      hojasDe(pdf).forEach((h, i) => {
        for (const t of h.textos.filter(x => TITULOS.includes(x.texto))) {
          const debajo = h.textos.filter(x => x.y > t.y + 4)
          expect(debajo.length, `«${t.texto}» en la hoja ${i + 1}, ${k} renglones`).toBeGreaterThan(0)
        }
      })
    }
  }, 120_000)

  it('punto 3 · la firma nunca queda sola en una hoja: la acompaña al menos el final de la última sección', async () => {
    // En la composición NORMAL (sin el rescate del punto 6, que la escondería), renglón a renglón.
    for (let k = 0; k <= 30; k += 1) {
      const pdf = await renderNivel(corrido(props(), k), { nivel: 0 })
      const hojas = hojasDe(pdf)
      const conFirma = hojas.find(h => h.textos.some(t => t.texto === 'Edgar Javier Alarcón S.'.replace('ó', 'ó')))!
      const otros = conFirma.textos.filter(t => !['Edgar Javier Alarc', 'Director Comercial', 'contacto@trappvel.com'].some(f => t.texto.startsWith(f)) && !t.texto.startsWith('Fotograf'))
      expect(otros.length, `${k} renglones`).toBeGreaterThan(0)
    }
  }, 120_000)

  const largo = () => props({}, {
    vuelos: Array.from({ length: 16 }, (_, i) => vuelo(i + 1)),
    cargosEnDestino: Array.from({ length: 12 }, (_, i) => ({ ciudad: `Ciudad ${i + 1}`, concepto: `Cargo número ${i + 1}`, monto: `${(i + 1) * 10} USD`, observacion: 'Se paga en el hotel.' })),
  })

  it('punto 5 · la tabla de vuelos se parte entre filas: cada vuelo entero, encabezado repetido, ninguna fila sola', async () => {
    for (const k of [0, 6, 12, 18]) {
      const { pdf } = await componerCotizacionTrappvel(corrido(largo(), k))
      const hojas = hojasDe(pdf).map(h => h.textos.map(t => t.texto).join(' '))
      const conVuelos = hojas.filter(h => /QA\d{3}/.test(h))
      expect(conVuelos.length, `${k} renglones`).toBeGreaterThan(1)
      for (const h of conVuelos) {
        expect(h.split('AEROLÍNEA').length - 1, `encabezado, ${k} renglones`).toBe(1)
        // Ninguna hoja se queda con un solo vuelo (cada vuelo imprime sus dos números).
        expect((h.match(/QA\d{2}1/g) ?? []).length, `filas por hoja, ${k} renglones`).toBeGreaterThanOrEqual(2)
      }
      for (let n = 1; n <= 16; n += 1) {
        const id = String(n).padStart(2, '0')
        const hoja = hojas.find(h => h.includes(`QA${id}1`))!
        expect(hoja, `vuelo ${n}`).toContain(`QA${id}2`)
        expect(hoja, `vuelo ${n}`).toContain(`Tarifa ${id}X`)
      }
    }
  }, 120_000)

  it('punto 5 · la tabla de cargos larga también: encabezado en cada hoja, cada fila entera y ninguna sola', async () => {
    const muchos = () => props({}, {
      cargosEnDestino: Array.from({ length: 40 }, (_, i) => ({ ciudad: `Ciudad ${i + 1}`, concepto: 'Tasa municipal', monto: `${(i + 1) * 10} USD`, observacion: 'Se paga en el hotel.' })),
    })
    const fila = (n: number) => new RegExp(`(^|\\s)${n * 10}\\s+USD`)
    for (const k of [0, 8, 16]) {
      const { pdf } = await componerCotizacionTrappvel(corrido(muchos(), k))
      const hojas = hojasDe(pdf).map(h => h.textos.map(t => t.texto).join(' '))
      const conCargos = hojas.filter(h => /\d0\s+USD/.test(h))
      expect(conCargos.length, `${k} renglones`).toBeGreaterThan(1)
      for (const h of conCargos) {
        expect(h.split('CIUDAD / HOTEL').length - 1, `encabezado, ${k} renglones`).toBe(1)
        expect((h.match(/\d0\s+USD/g) ?? []).length, `filas por hoja, ${k} renglones`).toBeGreaterThanOrEqual(2)
      }
      for (let n = 1; n <= 40; n += 1) expect(hojas.filter(h => fila(n).test(h)), `fila ${n}`).toHaveLength(1)
    }
  }, 120_000)

  it('punto 6 · se compacta SOLO si la última hoja queda por debajo del 35 % (y en el barrido pasa al menos una vez)', async () => {
    let compactadas = 0
    for (let k = 0; k <= 40; k += 4) {
      const { informe } = await componerCotizacionTrappvel(corrido(props(), k))
      const trabajaba = informe.antes.hojas === 1 || informe.antes.ocupacionUltima >= 0.35
      if (trabajaba) {
        expect(informe.composicion.nivel, `${k} renglones`).toBe(0)
      } else {
        expect(informe.renders, `${k} renglones`).toBeGreaterThan(1)
        expect(informe.motivo).toBe('ultima-hoja')
        if (informe.composicion.nivel > 0) {
          compactadas += 1
          expect(informe.despues.hojas < informe.antes.hojas || informe.despues.ocupacionUltima >= 0.35).toBe(true)
        }
      }
    }
    expect(compactadas).toBeGreaterThan(0)
  }, 180_000)

  it('pasos 2 y 3 · la foto de una alternativa baja a 1/4 del ancho y la de ciudad del capítulo a 110 pt; la portada y la Recomendada no cambian', async () => {
    const ANCHO = HOJA.ancho - HOJA.margen * 2
    const png = (r: number) => `data:image/png;base64,${Buffer.from(PNG_1x1(r)).toString('base64')}`
    const tres = props({
      itinerarios: [
        { nombre: 'Recomendada', esPrincipal: true, precio: 5_000_000, items: [item('HOTEL A', 5_000_000)] },
        { nombre: 'Económica', esPrincipal: false, precio: 3_900_000, items: [item('HOTEL B', 3_900_000)] },
      ],
    }, {
      foto: { url: png(10), rotulo: 'Portada', credito: 'Autor (CC BY 4.0)', proporcion: 1.5 },
      hoteles: [
        hotel({ hotel: 'Hotel Recomendado', ciudad: 'Cartagena', tarifas: [0] }),
        hotel({ hotel: 'Hotel Alternativo', ciudad: 'Cartagena', tarifas: [1], foto: { url: png(200), proporcion: 1.5 } }),
      ],
      fotosCiudades: [{ url: png(120), rotulo: 'Cartagena', credito: 'Otro autor (CC BY 4.0)', lugares: ['Cartagena'], proporcion: 1.5 }],
    })
    const imagenes = async (nivel: Composicion['nivel']) => hojasDe(await renderNivel(tres, { nivel })).flatMap(h => h.imagenes)
    // Normal: portada a todo el ancho y 190 de alto; la de ciudad y la de la alternativa a un tercio, 3:2.
    const [portada0, ciudad0, alterna0] = await imagenes(0)
    expect(portada0.ancho).toBeCloseTo(ANCHO, 0)
    expect(portada0.alto).toBeCloseTo(190, 0)
    expect(ciudad0.ancho).toBeCloseTo((ANCHO - 16) / 3, 0)
    expect(alterna0.ancho).toBeCloseTo((ANCHO - 16) / 3, 0)
    // Paso 2: solo la alternativa baja a un cuarto, en 3:2 (o más alta si su tarjeta lo es: punto 7).
    const [portada2, ciudad2, alterna2] = await imagenes(2)
    // (sube unos puntos por el espaciado compacto de arriba, pero no cambia de tamaño)
    expect([portada2.ancho, portada2.alto]).toEqual([portada0.ancho, portada0.alto])
    expect(ciudad2.ancho).toBeCloseTo(ciudad0.ancho, 1)
    expect(alterna2.ancho).toBeCloseTo((ANCHO - 24) / 4, 0)
    expect(alterna2.alto).toBeGreaterThanOrEqual(alterna2.ancho / 1.5 - 0.5)
    // Paso 3: la de ciudad del capítulo, a 110 de alto en 3:2; la portada sigue igual.
    const [portada3, ciudad3] = await imagenes(3)
    expect([portada3.ancho, portada3.alto]).toEqual([portada0.ancho, portada0.alto])
    expect(ciudad3.ancho).toBeCloseTo(110 * 1.5, 0)
  }, 60_000)

  it('⚠️ compactar nunca achica la letra: los mismos tamaños de texto en los cuatro niveles', async () => {
    const p = props({}, { hoteles: [hotel({ hotel: 'Hotel Casa del Puerto', ciudad: 'Cartagena' }), hotel({ hotel: 'Hotel Bocagrande', ciudad: 'Cartagena' })] })
    // Cada corrida de texto con su tamaño: la misma frase tiene que salir con la misma letra.
    const tamanos = async (nivel: Composicion['nivel']) =>
      hojasDe(await renderNivel(p, { nivel })).flatMap(h => h.textos.map(t => `${t.tam} · ${t.texto}`)).sort()
    const normal = await tamanos(0)
    expect(normal.length).toBeGreaterThan(30)
    for (const nivel of [1, 2, 3] as const) expect(await tamanos(nivel)).toEqual(normal)
  }, 60_000)

  it('⚠️ compactar nunca quita contenido: el mismo texto en los cuatro niveles', async () => {
    const p = largo()
    const palabras = async (nivel: Composicion['nivel']) => textoDelPDF(await renderNivel(p, { nivel }))
      // El «N de M» del pie cambia con las hojas; el resto tiene que ser idéntico.
      .replace(/COT-QA-PAG\s+\d+\s+de\s+\d+/g, '')
      .split(/\s+/).filter(Boolean).sort()
    const normal = await palabras(0)
    for (const nivel of [1, 2, 3] as const) expect(await palabras(nivel)).toEqual(normal)
  }, 60_000)
})
