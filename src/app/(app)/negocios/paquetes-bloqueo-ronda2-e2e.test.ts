/**
 * DE LOS PANTALLAZOS AL DOCUMENTO, SIN TOCAR NADA A MANO (Trappvel, 2026-11-03).
 *
 * Mauricio y el agente armaron a mano dos PDFs de paquete de bloqueo con la plantilla real. La meta es
 * que la asesora llegue al MISMO documento solo pegando pantallazos. Aquí corre el camino entero sobre
 * el doble de Supabase, con el motor de verdad: `pegarEnBloqueo` (la bandeja) con las lecturas de los
 * pantallazos de ATN, la respuesta «Pública» a la pregunta de la bandeja (`elegirTarifaDelPaquete`),
 * el recálculo, la acción del PDF y el modelo del documento (`modeloDePropuesta`).
 *
 *  · SAN ANDRÉS, 3 adultos (Triple): 7.323.615 / 6.884.589 / 9.332.151.
 *  · SANTA MARTA, 2 adultos (Doble): 3.040.226 / 3.306.050 / 3.685.796.
 *
 * El mismo vuelo en las tres versiones y cada hotel con su ficha. La lectura del modelo es una cola de
 * lecturas sintéticas con las cifras reales (`__fixtures__/bloqueo`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso } from '../../../../test/cotizacion-pdf-doble'
import { tablasBase } from '@/lib/cotizaciones/__fixtures__/bateria/casos'
import { INCLUYE, ISLA_BONITA, KORAY, SOL_CARIBE, VUELO_AV } from '@/lib/cotizaciones/__fixtures__/bloqueo/san-andres-1103'
import { MEDELLIN_RODADERO, PARAISO_TAYRONA, RODADERO_DORADO, VUELO_SMR } from '@/lib/cotizaciones/__fixtures__/bloqueo/santa-marta-1103'
import type { LecturaBloqueo } from '@/lib/cotizaciones/bloqueo-leer'
import type { HotelBloqueo, VueloBloqueo } from '@/lib/cotizaciones/bloqueo-paquete'
import { modeloDePropuesta, type EntradaModeloPropuesta, type ModeloPropuesta } from '@/lib/cotizaciones/propuesta/modelo-documento'

const estado = vi.hoisted(() => ({
  viaje: null as null | { composicion: { adultos: number; ninos: number; infantes: number }; fechas: { inicio: string; fin: string }; destino: string },
  cola: [] as unknown[],
  motor: [] as unknown[],
  motivos: null as null | string[],
}))

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(), workspaceId: 'ws-bateria', userId: 'p-asesora', staffId: 's-asesora', role: 'operator',
    areas: [], impersonating: false, realRole: 'operator', error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => false }))
vi.mock('@/lib/google-drive', () => ({
  uploadFileToDrive: async () => { throw new Error('Drive no debe llamarse') },
  createDriveFolder: async () => { throw new Error('Drive no debe llamarse') },
}))
vi.mock('@/lib/pdf/pdf-render-client', () => ({ isPdfRenderConfigured: () => false, renderViaService: async () => { throw new Error('no') } }))
vi.mock('@/lib/modulos/exigir-modulo', () => ({ exigirModulo: async () => ({ ok: true }), MENSAJE_MODULO_NO_ACTIVO: 'x', REQUISITO: { clarity: 'clarity' } }))
vi.mock('@/lib/cotizaciones/por-pasos-datos', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cotizaciones/por-pasos-datos')>()),
  exigirPorPasos: async () => ({ ok: true, estado: { encendido: true, motivo: null, piezas: null } }),
}))
vi.mock('@/lib/cotizaciones/bloqueo-modalidad', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cotizaciones/bloqueo-modalidad')>()),
  leerModalidadDelViaje: async () => ({ modalidad: { bloqueo: true, operador: 'ATN' }, error: null }),
}))
vi.mock('@/lib/cotizaciones/viaje-negocio', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cotizaciones/viaje-negocio')>()),
  leerViajeDelNegocio: async () => ({
    viaje: { ...estado.viaje!, presentacion: null, nivelDetalle: 'normal' },
    error: null,
    modalidad: { bloqueo: true, operador: 'ATN' },
    edadesMenores: null,
  }),
}))
// La lectura del modelo: una cola con las lecturas de los pantallazos.
vi.mock('@/lib/cotizaciones/bloqueo-leer', () => ({
  leerPantallazoDeBloqueo: async () => estado.cola.shift() ?? { ok: false, mensaje: 'sin lectura' },
}))
vi.mock('@/lib/cotizaciones/imagen-captura', () => ({
  guardarImagenDeCaptura: async (a: { lectura: { huellaImagen?: string } }) => (a.lectura.huellaImagen ? `sbext://ws-bateria/capturas/${a.lectura.huellaImagen}.png` : null),
}))
// El motor html: Chromium no corre aquí. Se guarda lo que recibe (la entrada del modelo).
vi.mock('@/lib/pdf/html/propuesta-html', () => ({
  pdfDePropuestaHtml: async (entrada: unknown) => {
    estado.motor.push(entrada)
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    doc.addPage()
    return { pdf: Buffer.from(await doc.save()), modelo: null, html: '', medidas: { totalMs: 1, pdfBytes: 1, peticionesBloqueadas: [] } }
  },
}))
vi.mock('@/lib/pdf/marca-borrador', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/pdf/marca-borrador')>()
  return { ...real, ponerMarcaDeBorrador: async (pdf: Buffer, motivos: readonly string[]) => { estado.motivos = [...motivos]; return pdf } }
})

import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { recalcularTotales } from './cotizacion-actions'
import { elegirTarifaDelPaquete, pegarEnBloqueo } from './bloqueo-actions'

const COT = 'cot-ronda2'

const vuelo = (v: VueloBloqueo, huella: string): LecturaBloqueo => ({ ok: true, cual: 'vuelo', vuelo: v, huella })
const hotel = (h: HotelBloqueo, huella: string): LecturaBloqueo => ({ ok: true, cual: 'hotel', hotel: h, incluye: INCLUYE, operador: 'ATN', huella })

interface Corrida {
  modelo: ModeloPropuesta
  borrador: boolean
  motivos: string[]
  /** Antes de responder «Pública»: lo que imprimía el documento y por qué era borrador. */
  antes: { precios: number[]; borrador: boolean; motivos: string[] }
}

async function documento(): Promise<{ modelo: ModeloPropuesta; borrador: boolean; motivos: string[] }> {
  estado.motor = []
  estado.motivos = null
  await recalcularTotales(COT)
  const r = (await generateCotizacionPDF(COT, { vistaPrevia: true, porPasos: true })) as { success: boolean; error?: string; borrador?: boolean }
  if (!r.success) throw new Error(r.error)
  const entrada = estado.motor[0] as EntradaModeloPropuesta | undefined
  if (!entrada) throw new Error('el motor html no recibió la propuesta')
  return { modelo: modeloDePropuesta(entrada), borrador: r.borrador === true, motivos: estado.motivos ?? [] }
}

/** Lo que hace la asesora: pega el vuelo y los hoteles en la bandeja y responde «Pública». */
async function armar(viaje: NonNullable<typeof estado.viaje>, lecturas: LecturaBloqueo[]): Promise<Corrida> {
  base.secuencia = 0
  base.tablas = tablasBase({ cot: COT, neg: 'neg-ronda2', consecutivo: 'COT-2026-9201', destino: viaje.destino, margen: null, reglas: null, items: [] })
  estado.viaje = viaje
  estado.cola = []
  for (const l of lecturas) {
    estado.cola.push(l)
    const r = await pegarEnBloqueo(COT, 'data:image/png;base64,AAAA')
    if (!r.success) throw new Error(`pegarEnBloqueo: ${r.error}`)
  }
  const antes = await documento()
  // La bandeja pregunta una vez por el paquete: «Pública (el precio ya trae la comisión)», 15 %.
  const primera = (base.tablas.items as { id: string }[])[0].id
  const r = await elegirTarifaDelPaquete(primera, 'publica', { tipo: 'pct', valor: 15 })
  if (!r.success) throw new Error(r.error)
  const despues = await documento()
  return { ...despues, antes: { precios: antes.modelo.tarifas.map(t => t.precio), borrador: antes.borrador, motivos: antes.motivos } }
}

const precioDe = (m: ModeloPropuesta, hotelNombre: string) => {
  const t = m.tarifas.find(x => x.hoteles.some(h => h.nombre === hotelNombre))
  if (!t) throw new Error(`ninguna versión con ${hotelNombre}: ${JSON.stringify(m.tarifas.map(x => x.hoteles))}`)
  return t.precio
}

const numerosDeVuelo = (m: ModeloPropuesta, indice: number) =>
  m.vuelos.filter(v => v.tarifas.length === 0 || v.tarifas.includes(indice)).map(v => [v.sentido, v.numero])

function verificar(m: ModeloPropuesta, esperado: { hotel: string; precio: number }[], numeros: [string, string]) {
  // Tres versiones, cada una con su precio (Pública: el total por personas es el precio al cliente).
  expect(m.tarifas).toHaveLength(3)
  for (const e of esperado) expect(precioDe(m, e.hotel), e.hotel).toBe(e.precio)
  expect(m.tarifas.map(t => t.precio).sort((a, b) => a - b)).toEqual(esperado.map(e => e.precio).sort((a, b) => a - b))
  // El MISMO vuelo (ida y regreso) en las tres.
  for (const t of m.tarifas) {
    const vs = numerosDeVuelo(m, t.indice)
    expect(vs.map(v => v[0]).sort(), `vuelos de ${t.nombre}`).toEqual(['ida', 'regreso'])
    expect(vs.map(v => String(v[1] ?? '')).join(' ')).toContain(numeros[0])
    expect(vs.map(v => String(v[1] ?? '')).join(' ')).toContain(numeros[1])
  }
  // Cada hotel con su ficha, de SU versión.
  const fichas = m.hoteles.flatMap(c => c.opciones)
  expect(fichas.map(o => o.hotel).sort()).toEqual(esperado.map(e => e.hotel).sort())
  for (const o of fichas) {
    const suya = m.tarifas.find(t => t.hoteles.some(h => h.nombre === o.hotel))!
    expect(o.tarifas, o.hotel).toEqual([suya.indice])
  }
}

describe('SAN ANDRÉS: vuelo AV 9376 / AV 9803 + Koray, Isla Bonita y Sol Caribe; 3 adultos; Pública', () => {
  let c: Corrida
  beforeEach(async () => {
    c = await armar(
      { composicion: { adultos: 3, ninos: 0, infantes: 0 }, fechas: { inicio: '2026-12-23', fin: '2026-12-27' }, destino: 'San Andrés' },
      [vuelo(VUELO_AV, 'v1'), hotel(KORAY, 'h1'), hotel(ISLA_BONITA, 'h2'), hotel(SOL_CARIBE, 'h3')],
    )
  }, 60_000)

  it('3 versiones con 7.323.615 / 6.884.589 / 9.332.151, el mismo vuelo y cada hotel con su ficha', () => {
    verificar(c.modelo, [
      { hotel: 'Koray Hotel', precio: 7_323_615 },
      { hotel: 'Hotel Isla Bonita', precio: 6_884_589 },
      { hotel: 'Hotel Sol Caribe San Andres', precio: 9_332_151 },
    ], ['9376', '9803'])
    expect(c.motivos).not.toContain('margen')
    expect({ borrador: c.borrador, motivos: c.motivos }).toEqual({ borrador: false, motivos: [] })
  })

  it('antes de responder «Pública o Neta» no sale inflado: a costo y como borrador', () => {
    expect([...c.antes.precios].sort((a, b) => a - b)).toEqual([6_884_589, 7_323_615, 9_332_151])
    expect(c.antes.borrador).toBe(true)
    // Frena por el paquete sin responder (no por margen): la pregunta es la que falta.
    expect(c.antes.motivos).toEqual(['paquete_incompleto'])
  })
})

describe('SANTA MARTA: vuelo AV 9764 / AV 8507 + Paraíso Tayrona, Rodadero Dorado y Medellín Rodadero; 2 adultos (Doble); Pública', () => {
  let c: Corrida
  beforeEach(async () => {
    c = await armar(
      { composicion: { adultos: 2, ninos: 0, infantes: 0 }, fechas: { inicio: '2027-01-03', fin: '2027-01-06' }, destino: 'Santa Marta' },
      [vuelo(VUELO_SMR, 'v1'), hotel(PARAISO_TAYRONA, 'h1'), hotel(RODADERO_DORADO, 'h2'), hotel(MEDELLIN_RODADERO, 'h3')],
    )
  }, 60_000)

  it('3 versiones con 3.040.226 / 3.306.050 / 3.685.796, el mismo vuelo y cada hotel con su ficha', () => {
    verificar(c.modelo, [
      { hotel: 'Paraíso Tayrona', precio: 3_040_226 },
      { hotel: 'Hotel Rodadero Dorado', precio: 3_306_050 },
      { hotel: 'Hotel Medellin Rodadero', precio: 3_685_796 },
    ], ['9764', '8507'])
    // Las tres en Doble: 2 adultos, una habitación.
    for (const o of c.modelo.hoteles.flatMap(x => x.opciones)) expect(o.acomodacion ?? '').toMatch(/doble/i)
  })
})
