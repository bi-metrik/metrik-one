/**
 * El banco provisional de fotos y la regla que decide cuáles lleva el documento.
 *
 * Las pruebas del banco leen los archivos REALES de `templates/fotos-ciudad/`: un archivo
 * que falte en el repo es justo el defecto que tienen que atrapar.
 */
import fs from 'node:fs'
import { inflateSync } from 'node:zlib'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'

import CotizacionTrappvelPDF from './cotizacion-trappvel-pdf'
import type { CotizacionPDFProps, ViajePDF } from './cotizacion-props'
import { claveDeCiudad, fotosDeCiudad, type FotoCiudad } from './fotos-ciudad'
import { MAXIMO_FOTOS_POR_DOCUMENTO, ciudadesEnTexto, creditosDeFotos, fotosDelViaje } from './fotos-del-viaje'
import { plantillaUsaFotosDeCiudad, slugsConPlantillaPropia } from './plantillas-cotizacion'
import { textoDelPDF } from './texto-del-pdf'
import { medirImagen } from '@/lib/og/medidas-tarjeta'

describe('el banco provisional', () => {
  it('la clave no distingue tildes, mayúsculas ni espacios', () => {
    expect(claveDeCiudad('San Andrés')).toBe('san andres')
    expect(claveDeCiudad('SAN ANDRES')).toBe('san andres')
    expect(claveDeCiudad('  san   andres ')).toBe('san andres')
  })

  it('«San Andrés», «SAN ANDRES» y «san andres» encuentran la MISMA foto', () => {
    const rutas = ['San Andrés', 'SAN ANDRES', 'san andres'].map(c => fotosDeCiudad(c)[0]?.ruta)
    expect(rutas[0]).toBeTruthy()
    expect(new Set(rutas).size).toBe(1)
    expect(fotosDeCiudad('San Andrés')[0].rotulo).toBe('SAN ANDRÉS · JOHNNY CAY')
  })

  it('el destino de un vuelo trae el código IATA pegado y se encuentra igual', () => {
    expect(fotosDeCiudad('Providencia PVA')[0].ciudad).toBe('providencia')
    expect(fotosDeCiudad('PVA')[0].ciudad).toBe('providencia')
  })

  it('una ciudad que no está en el banco no devuelve nada', () => {
    expect(fotosDeCiudad('Villa Inventada del Norte')).toEqual([])
    expect(fotosDeCiudad('Armenia AXM')).toEqual([])
  })

  it('toda foto del banco existe en disco, pesa menos de 300 KB y trae crédito', () => {
    for (const c of ['Cancún', 'Ciudad de México', 'Madrid', 'Roma', 'París', 'Bogotá', 'San Andrés', 'Providencia']) {
      const fotos = fotosDeCiudad(c)
      expect(fotos.length, c).toBe(2)
      for (const f of fotos) {
        expect(fs.statSync(f.ruta).size, f.ruta).toBeLessThanOrEqual(300 * 1024)
        expect(f.credito).toMatch(/^.+ \(Wikimedia Commons, (CC0|CC BY(-SA)? \d\.\d)\)$/)
        expect(f.rotulo).toBe(f.rotulo.toUpperCase())
      }
    }
  })

  it('toda foto declara sus medidas REALES y un foco dentro de la foto', () => {
    // Las medidas se declaran para no leer el archivo en cada documento; si alguien cambia
    // un archivo sin actualizar la entrada, el encuadre se calcularía con otra foto.
    for (const c of ['Cancún', 'Ciudad de México', 'Madrid', 'Roma', 'París', 'Bogotá', 'San Andrés', 'Providencia']) {
      for (const f of fotosDeCiudad(c)) {
        const m = medirImagen(fs.readFileSync(f.ruta))
        expect(m, f.ruta).not.toBeNull()
        expect(f.proporcion, f.ruta).toBeCloseTo(m!.ancho / m!.alto, 6)
        for (const v of [f.foco.x, f.foco.y]) {
          expect(v, f.ruta).toBeGreaterThanOrEqual(0)
          expect(v, f.ruta).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('el foco se fijó mirando: la cabaña del Acuario está abajo a la izquierda, no en el centro', () => {
    const acuario = fotosDeCiudad('San Andrés')[1]
    expect(acuario.rotulo).toBe('SAN ANDRÉS · EL ACUARIO')
    expect(acuario.foco.x).toBeLessThan(0.5)
    expect(acuario.foco.y).toBeGreaterThan(0.5)
  })

  it('solo la plantilla de Trappvel imprime fotos (R6)', () => {
    expect(slugsConPlantillaPropia().filter(plantillaUsaFotosDeCiudad)).toEqual(['trappvel'])
    expect(plantillaUsaFotosDeCiudad('metrik')).toBe(false)
    expect(plantillaUsaFotosDeCiudad(null)).toBe(false)
  })
})

// Banco falso para probar la REGLA sin depender de qué fotos haya en disco.
const foto = (ciudad: string, n: number): FotoCiudad => ({
  ciudad,
  ruta: `/fotos/${ciudad}-${n}.jpg`,
  rotulo: `${ciudad.toUpperCase()} · ${n}`,
  autor: `Autor ${ciudad}`,
  licencia: 'CC BY-SA 4.0',
  credito: `Autor ${ciudad} (Wikimedia Commons, CC BY-SA 4.0)`,
  foco: { x: 0.5, y: 0.5 },
  proporcion: 1.5,
})
const BANCO: Record<string, FotoCiudad[]> = {
  providencia: [foto('providencia', 1), foto('providencia', 2)],
  'san andres': [foto('san andres', 1)],
  madrid: [foto('madrid', 1), foto('madrid', 2)],
  roma: [foto('roma', 1), foto('roma', 2)],
  paris: [foto('paris', 1), foto('paris', 2)],
  bogota: [foto('bogota', 1), foto('bogota', 2)],
}
const buscar = (c: string) => BANCO[claveDeCiudad(c).replace(/ [a-z]{3}$/, '')] ?? []

describe('qué fotos lleva el documento', () => {
  it('portada de la ciudad destino y, en el cuerpo, OTRA foto de esa ciudad', () => {
    const r = fotosDelViaje({
      destino: 'Providencia',
      vuelos: [{ destino: 'Providencia PVA' }],
      hoteles: [{ ciudad: 'Providencia' }],
    }, buscar)
    expect(r.portada?.url).toBe('/fotos/providencia-1.jpg')
    expect(r.ciudades.map(f => f.url)).toEqual(['/fotos/providencia-2.jpg'])
  })

  it('si la ciudad de portada solo tiene una foto, no se repite en el cuerpo', () => {
    const r = fotosDelViaje({ destino: 'San Andrés', vuelos: [], hoteles: [] }, buscar)
    expect(r.portada?.url).toBe('/fotos/san andres-1.jpg')
    expect(r.ciudades).toEqual([])
  })

  it('destino sin foto: no hay portada con foto, aunque otra ciudad del viaje sí tenga', () => {
    const r = fotosDelViaje({ destino: 'Villa Inventada', vuelos: [{ destino: 'Madrid MAD' }], hoteles: [] }, buscar)
    expect(r.portada).toBeNull()
    expect(r.ciudades.map(f => f.url)).toEqual(['/fotos/madrid-1.jpg'])
  })

  it('nunca más de cuatro fotos en todo el documento, portada incluida', () => {
    const r = fotosDelViaje({
      destino: 'Madrid, Roma y París',
      vuelos: [{ destino: 'Bogotá BOG' }, { destino: 'Providencia PVA' }],
      hoteles: [{ ciudad: 'Roma' }],
    }, buscar)
    const total = (r.portada ? 1 : 0) + r.ciudades.length
    expect(total).toBe(MAXIMO_FOTOS_POR_DOCUMENTO)
    expect(r.portada?.url).toBe('/fotos/madrid-1.jpg')
    expect(r.ciudades.map(f => f.url)).toEqual(['/fotos/madrid-2.jpg', '/fotos/roma-1.jpg', '/fotos/paris-1.jpg'])
  })

  it('el origen y las escalas no cuentan: solo destinos de vuelo y ciudades de hotel', () => {
    const r = fotosDelViaje({ destino: null, vuelos: [{ destino: 'Armenia AXM' }], hoteles: [] }, buscar)
    expect(r.portada).toBeNull()
    expect(r.ciudades).toEqual([])
  })

  it('el texto libre del destino se parte por comas, « · » y «y» suelta', () => {
    expect(ciudadesEnTexto('Madrid, Roma y París')).toEqual(['Madrid', 'Roma', 'París'])
    expect(ciudadesEnTexto('Cancun · Providencia PVA')).toEqual(['Cancun', 'Providencia PVA'])
    expect(ciudadesEnTexto('Guayaquil')).toEqual(['Guayaquil'])
  })

  it('los créditos no repiten un autor con la misma licencia', () => {
    const c = creditosDeFotos([
      { url: 'a', rotulo: null, credito: 'Felviper (Wikimedia Commons, CC BY-SA 4.0)' },
      { url: 'b', rotulo: null, credito: 'Felviper (Wikimedia Commons, CC BY-SA 4.0)' },
      null,
    ])
    expect(c).toEqual(['Felviper (Wikimedia Commons, CC BY-SA 4.0)'])
  })
})

// ── Lo que el PDF IMPRIME, leído del binario ──────────────────────────────────

const viaje = (over: Partial<ViajePDF> = {}): ViajePDF => ({
  viajeros: '2 adultos',
  destino: 'Providencia',
  fechas: null,
  duracion: null,
  presentacion: null,
  foto: null,
  vuelos: [],
  hoteles: [],
  cargosEnDestino: [],
  nivelDetalle: 'normal',
  pie: 'www.trappvel.com',
  firma: null,
  ...over,
})

const props = (v: ViajePDF): CotizacionPDFProps => ({
  cotizacion: {
    consecutivo: 'COT-2026-0099',
    descripcion: 'Viaje de prueba',
    valor_total: 1000000,
    modo: 'detallado',
    fecha_envio: null,
    fecha_validez: null,
    condiciones_pago: null,
    notas: null,
    descuento_porcentaje: 0,
    descuento_valor: 0,
  },
  empresa: { nombre: 'Familia Prueba', nit: null, contacto_nombre: null, contacto_email: null, telefono: null, direccion: null, ciudad: null },
  vendedor: { nombre: 'Trappvel', razon_social: null, nit: null, logo_url: null, color_primario: '#E6337F', telefono: null, email: null, direccion: null, ciudad: null },
  items: [{ nombre: 'HOTEL', descripcion: null, precio_venta: 1000000, descuento_porcentaje: 0, cantidad: 1 }],
  viaje: v,
} as CotizacionPDFProps)

// renderToBuffer tipa su argumento como el elemento <Document>; la plantilla lo devuelve.
const render = async (v: ViajePDF) =>
  Buffer.from(await renderToBuffer(createElement(CotizacionTrappvelPDF, props(v)) as Parameters<typeof renderToBuffer>[0]))
/** Los flujos de dibujo de las páginas (donde van las posiciones de las imágenes), descomprimidos. */
const textoDeDibujo = (pdf: Buffer) => {
  const salida: string[] = []
  let desde = 0
  for (;;) {
    const ini = pdf.indexOf('stream', desde)
    if (ini === -1) break
    let inicio = ini + 'stream'.length
    if (pdf[inicio] === 0x0d) inicio++
    if (pdf[inicio] === 0x0a) inicio++
    const fin = pdf.indexOf('endstream', inicio)
    if (fin === -1) break
    try {
      const t = inflateSync(pdf.subarray(inicio, fin)).toString('latin1')
      if (t.includes(' Do')) salida.push(t)
    } catch {
      // una imagen o una fuente: no es un flujo de dibujo
    }
    desde = fin + 'endstream'.length
  }
  return salida.join('\n')
}

/** Cuántas imágenes embebió el PDF. pdfkit escribe cada una como XObject de tipo Image. */
const imagenes = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length

describe('el PDF con las fotos del banco real', () => {
  it('Providencia: portada, una foto en el cuerpo, rótulos y créditos', async () => {
    const f = fotosDelViaje({ destino: 'Providencia', vuelos: [{ destino: 'Providencia PVA' }], hoteles: [] }, fotosDeCiudad)
    const pdf = await render(viaje({ foto: f.portada, fotosCiudades: f.ciudades }))
    const t = textoDelPDF(pdf)
    expect(imagenes(pdf)).toBe(2)
    expect(t).toContain('PROVIDENCIA · MCBEAN LAGOON')
    expect(t).toContain('PROVIDENCIA · THE PEAK')
    // Las dos son del mismo autor y licencia: se nombra una vez.
    expect(t).toContain('Fotografías: Felviper (Wikimedia Commons, CC BY-SA 4.0)')
  })

  it('el foco y la proporción del banco llegan a la foto del documento', () => {
    const f = fotosDelViaje({ destino: 'San Andrés', vuelos: [], hoteles: [] }, fotosDeCiudad)
    expect(f.portada?.foco).toEqual(fotosDeCiudad('San Andrés')[0].foco)
    expect(f.ciudades[0].foco).toEqual({ x: 0.3, y: 0.72 })
    expect(f.ciudades[0].proporcion).toBeCloseTo(1600 / 1199, 6)
  })

  it('⚠️ la plantilla encuadra con el foco: moverlo mueve la foto en el PDF, en la portada y en la miniatura', async () => {
    // Sin esto, el foco podría llegar hasta la plantilla y no usarse: el recorte volvería al
    // centro sin que nada fallara. Se comparan los flujos de dibujo, que no llevan fechas.
    const f = fotosDelViaje({ destino: 'San Andrés', vuelos: [], hoteles: [] }, fotosDeCiudad)
    type Foco = { x: number; y: number } | undefined
    const dibujo = async (portada: Foco, miniaturas: Foco) => textoDeDibujo(await render(viaje({
      destino: 'San Andrés',
      foto: f.portada && { ...f.portada, foco: portada },
      fotosCiudades: f.ciudades.map(c => ({ ...c, foco: miniaturas })),
    })))
    const arriba = { x: 0.5, y: 0 }
    const abajo = { x: 0.5, y: 1 }
    const base = await dibujo(arriba, arriba)
    expect(await dibujo(abajo, arriba)).not.toBe(base)
    expect(await dibujo(arriba, abajo)).not.toBe(base)
    // Y sin foco sale igual que centrado: una foto propia del cliente no cambia.
    const centro = { x: 0.5, y: 0.5 }
    expect(await dibujo(undefined, undefined)).toBe(await dibujo(centro, centro))
  })

  it('ciudad sin foto: cero imágenes, sin créditos, y la portada de marca de siempre', async () => {
    const f = fotosDelViaje({ destino: 'Villa Inventada', vuelos: [], hoteles: [] }, fotosDeCiudad)
    const pdf = await render(viaje({ destino: 'Villa Inventada', foto: f.portada, fotosCiudades: f.ciudades }))
    const t = textoDelPDF(pdf)
    expect(imagenes(pdf)).toBe(0)
    expect(t).not.toContain('Fotografías')
    expect(t).toContain('TRAPPVEL')
  })
})
