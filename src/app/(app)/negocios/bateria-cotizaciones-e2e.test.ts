/**
 * BATERÍA DE REGRESIÓN DE COTIZACIONES (decisión D1 de Mauricio, 2026-10-29: «que ninguna cotización
 * ya armada se dañe»). Corre en CI en cada PR.
 *
 * Cinco cotizaciones sintéticas con la forma de las reales (`__fixtures__/bateria/casos.ts`) pasan por
 * el motor DE VERDAD sobre el doble de Supabase: las acciones del paquete de bloqueo, el recálculo
 * (`recalcularTotales`), la regla única del piso (`medirSalida`), la acción del PDF
 * (`generateCotizacionPDF`, con el motor html de Trappvel) y el modelo del documento
 * (`modeloDePropuesta`). Lo que deben dar lo dice el oráculo (`oraculo.ts`), escrito con la regla del
 * negocio y no con el motor.
 *
 * Invariantes, por caso:
 *  I1 · precio de cada línea según su tipo (Neta con su margen o el heredado, Pública al precio público).
 *  I2 · el margen con que se juzga cada opción es el margen general de D2.
 *  I3 · ninguna opción bajo el piso (o sin margen medible) sale limpia, y ninguna sana se frena por margen.
 *  I3b · una Pública sin comisión frena con su propio motivo (D3).
 *  I4 · todas las opciones que van al cliente aparecen en el PDF, con su precio.
 *  I5 · «Incluye» dice lo que marcan las casillas del paquete (solo bloqueo).
 *  I6 · el régimen no se afirma de más («Todos los hoteles incluyen el desayuno»).
 *  I7 · el itinerario día a día cubre todos los días del viaje.
 *  I8 · la foto del resumen (snapshot): un cambio de cifras se ve en el diff del PR.
 *
 * Lo que HOY falla por las decisiones D2–D6 va con `it.fails` y el nombre de la decisión
 * (`FALLA_HOY`): CI queda verde, y el PR que arregle una decisión tiene que pasar su caso a `it`
 * (si lo arregla y no lo pasa, `it.fails` se pone rojo solo).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'
import { CASO_QA_1352, CASO_QA_1359, CASOS, type CasoBateria, type ClaveCaso } from '@/lib/cotizaciones/__fixtures__/bateria/casos'
import { algunoBajoElPiso, clave, lineaEsperada, margenEsperado, soloDesayuno } from '@/lib/cotizaciones/__fixtures__/bateria/oraculo'
import { modeloDePropuesta, type EntradaModeloPropuesta, type ModeloPropuesta } from '@/lib/cotizaciones/propuesta/modelo-documento'
import type { CotizacionPDFProps } from '@/lib/pdf/cotizacion-props'
import type { MedicionDeSalida } from '@/lib/cotizaciones/piso-salida'

const estado = vi.hoisted(() => ({
  caso: null as null | { viaje: CasoBateria['viaje']; bloqueo: boolean },
  motor: [] as unknown[],
  motivos: null as null | string[],
  /** Con Chromium (prueba real del #1359): el motor html imprime de verdad y se guarda lo impreso. */
  chromium: false,
  impreso: null as null | { pdf: Buffer; html: string; hojas: unknown },
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
// La forma por pasos está encendida en la línea de viaje (el interruptor vive en la config del espacio).
vi.mock('@/lib/cotizaciones/por-pasos-datos', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cotizaciones/por-pasos-datos')>()),
  exigirPorPasos: async () => ({ ok: true, estado: { encendido: true, motivo: null, piezas: null } }),
}))
vi.mock('@/lib/cotizaciones/bloqueo-modalidad', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cotizaciones/bloqueo-modalidad')>()),
  leerModalidadDelViaje: async () => ({
    modalidad: estado.caso?.bloqueo ? { bloqueo: true, operador: 'Operador Ficticio' } : { bloqueo: false, operador: null },
    error: null,
  }),
}))
vi.mock('@/lib/cotizaciones/viaje-negocio', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/cotizaciones/viaje-negocio')>()),
  leerViajeDelNegocio: async () => {
    const v = estado.caso!.viaje
    return {
      viaje: { composicion: v.composicion, fechas: v.fechas, destino: v.destino, presentacion: null, nivelDetalle: 'normal' },
      error: null,
      modalidad: estado.caso?.bloqueo ? { bloqueo: true, operador: 'Operador Ficticio' } : { bloqueo: false, operador: null },
      edadesMenores: v.edadesMenores,
    }
  },
}))
// El motor html de la propuesta: Chromium no corre aquí. Se guarda lo que recibe (la entrada del modelo).
vi.mock('@/lib/pdf/html/propuesta-html', async importOriginal => ({
  pdfDePropuestaHtml: async (entrada: unknown, opts: unknown) => {
    estado.motor.push(entrada)
    if (estado.chromium) {
      const real = await importOriginal<typeof import('@/lib/pdf/html/propuesta-html')>()
      const r = await real.pdfDePropuestaHtml(entrada as Parameters<typeof real.pdfDePropuestaHtml>[0], opts as Parameters<typeof real.pdfDePropuestaHtml>[1])
      estado.impreso = { pdf: r.pdf, html: r.html, hojas: r.medidas.hojas ?? null }
      return r
    }
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.create()
    doc.addPage()
    return { pdf: Buffer.from(await doc.save()), modelo: null, html: '', medidas: { totalMs: 1, pdfBytes: 1, peticionesBloqueadas: [] } }
  },
}))
// La marca de agua: se guardan los motivos tal cual los decidió la acción del PDF.
vi.mock('@/lib/pdf/marca-borrador', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/pdf/marca-borrador')>()
  return {
    ...real,
    ponerMarcaDeBorrador: async (pdf: Buffer, motivos: readonly string[]) => {
      estado.motivos = [...motivos]
      return pdf
    },
  }
})

import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { recalcularTotales } from './cotizacion-actions'
import { ajustarReglasDelPaquete, crearPaqueteBloqueo, guardarPaqueteBloqueo, paqueteEnPropuesta } from './bloqueo-actions'
import { deshacerPorPasos, elegirOpcionEnTarifa } from './por-pasos-actions'
import { cascadaVigente, contextoDeCotizacion, leerItinerarios } from '@/lib/cotizaciones/itinerarios-datos'
import { itemsDelItinerario } from '@/lib/cotizaciones/itinerarios'
import { medirSalida } from '@/lib/cotizaciones/piso-salida'
import { costoDeAgencia, cascadaDeItinerario } from '@/lib/cotizaciones/itinerarios'
import { nombresVisiblesDeTarifas } from '@/lib/cotizaciones/tarifas'
import { tarifasCalculadas } from '@/lib/cotizaciones/por-pasos-vista'
import { motivoPublicasSinComision, publicasSinComisionQueSalen } from '@/lib/cotizaciones/comision-publica'
import { htmlDePropuesta, type RecursosPropuesta } from '@/lib/pdf/html/trappvel/plantilla'

// ── Lo que hoy falla, y por qué decisión ─────────────────────────────────────

type Invariante = 'I1' | 'I2' | 'I3' | 'I3b' | 'I4' | 'I5' | 'I6' | 'I7'

/**
 * Casos × invariantes que HOY no cumplen la decisión que los nombra. Cada uno corre con `it.fails`:
 * pasa mientras siga fallando. Al arreglar la decisión, se borra de aquí (el `it.fails` se pondría
 * rojo al dejar de fallar).
 */
// Vacío desde el PR de D2–D6 (2026-10-29): todos los casos cumplen. El PR que deje uno sin cumplir
// a propósito lo anota aquí con la decisión que lo explica.
const FALLA_HOY: Partial<Record<ClaveCaso, Partial<Record<Invariante, string>>>> = {}

// ── Correr un caso ───────────────────────────────────────────────────────────

interface Resultado {
  medicion: MedicionDeSalida
  /** Los sujetos del motor (tarifas o la cotización) con los nombres de sus líneas. */
  sujetosDelMotor: { nombre: string | null; lineas: string[]; total: number; margen: number | null; bajoPiso: boolean }[]
  items: Fila[]
  valorTotal: number
  borrador: boolean
  motivos: string[]
  props: CotizacionPDFProps
  modelo: ModeloPropuesta
}

async function correr(caso: CasoBateria): Promise<Resultado> {
  base.secuencia = 0
  base.tablas = caso.tablas()
  estado.caso = { viaje: caso.viaje, bloqueo: !!caso.paquetes }
  estado.motor = []
  estado.motivos = null

  // (a) se arma con las acciones reales del paquete de bloqueo, como la asesora.
  for (const p of caso.paquetes ?? []) {
    const creado = await crearPaqueteBloqueo(caso.cotizacionId)
    if (!creado.success) throw new Error(`crearPaqueteBloqueo: ${creado.error}`)
    const guardado = await guardarPaqueteBloqueo(creado.itemId, { paquete: structuredClone(p.paquete), comision: p.comision })
    if (!guardado.success) throw new Error(`guardarPaqueteBloqueo: ${guardado.error}`)
  }
  if (caso.margenDeLaCotizacionAlFinal !== undefined) {
    const cot = (base.tablas.cotizaciones as Fila[]).find(c => c.id === caso.cotizacionId)!
    cot.margen_porcentaje = caso.margenDeLaCotizacionAlFinal
  }
  await recalcularTotales(caso.cotizacionId)
  return medir(caso)
}

/** Lo que mide el motor y lo que imprime el PDF de la cotización tal como está en el doble. */
async function medir(caso: CasoBateria, opciones: { incluyePorOne?: boolean } = {}): Promise<Resultado> {
  estado.motor = []
  estado.motivos = null
  const supabase = clienteFalso()
  const ctx = await contextoDeCotizacion(supabase, caso.cotizacionId)
  const filas = await leerItinerarios(supabase, caso.cotizacionId)
  if (!ctx) throw new Error('sin contexto')
  const medicion = medirSalida(ctx, filas)
  const nombreDe = new Map(ctx.items.map(i => [i.id, i.nombre ?? '']))
  const sujetosDelMotor = medicion.sujetos.map(s => {
    const ids = s.tipo === 'tarifa'
      ? itemsDelItinerario(ctx.items, (filas ?? []).find(f => f.id === s.id)?.seleccion ?? [])
      : cascadaVigente(ctx, filas).lineas.map(l => l.id as string)
    return { nombre: s.nombre, lineas: ids.map(id => nombreDe.get(id) ?? id), total: s.total, margen: s.margenRealPct, bajoPiso: s.bajoPiso }
  })

  const r = (await generateCotizacionPDF(caso.cotizacionId, { vistaPrevia: true, porPasos: true, ...opciones })) as { success: boolean; error?: string; borrador?: boolean }
  if (!r.success) throw new Error(r.error)
  const entrada = estado.motor[0] as EntradaModeloPropuesta | undefined
  if (!entrada) throw new Error('el motor html no recibió la propuesta')
  const cot = (base.tablas.cotizaciones as Fila[]).find(c => c.id === caso.cotizacionId)!
  return {
    medicion,
    sujetosDelMotor,
    items: (base.tablas.items as Fila[]).filter(i => i.cotizacion_id === caso.cotizacionId),
    valorTotal: Number(cot.valor_total),
    borrador: r.borrador === true,
    motivos: estado.motivos ?? [],
    props: entrada.props,
    modelo: modeloDePropuesta(entrada),
  }
}

// ── Lo que imprime el PDF ────────────────────────────────────────────────────

type LineaPdf = { nombre: string; precio_venta: number; cantidad: number; valorAdicionales?: number }

/** Las opciones que el documento le muestra al cliente: cada bloque de tarifa, o la lista entera. */
function opcionesDelPdf(props: CotizacionPDFProps): { nombre: string | null; precio: number; lineas: string[] }[] {
  const bloques = props.itinerarios ?? []
  if (bloques.length > 0) return bloques.map(b => ({ nombre: b.nombre, precio: b.precio, lineas: (b.items as LineaPdf[]).map(i => i.nombre) }))
  return [{ nombre: null, precio: props.cotizacion.valor_total, lineas: (props.items as LineaPdf[]).map(i => i.nombre) }]
}

const mismoConjunto = (a: readonly string[], b: readonly string[]) => {
  const x = [...a].map(clave).sort()
  const y = [...b].map(clave).sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}

const textoDelModelo = (m: ModeloPropuesta) => clave(JSON.stringify(m))

// ── Las pruebas ──────────────────────────────────────────────────────────────

for (const caso of CASOS) {
  describe(caso.titulo, () => {
    let r: Resultado
    beforeAll(async () => { r = await correr(caso) }, 60_000)

    const fallaHoy = FALLA_HOY[caso.clave] ?? {}
    const prueba = (inv: Invariante, nombre: string, fn: () => void) => {
      const decision = fallaHoy[inv]
      if (decision) it.fails(`${inv} · ${nombre} — HOY FALLA: ${decision}`, fn)
      else it(`${inv} · ${nombre}`, fn)
    }

    prueba('I1', 'cada línea vale lo de su tipo (Neta con su margen, Pública al precio público)', () => {
      for (const l of caso.lineas) {
        const item = r.items.find(i => clave(i.nombre as string) === clave(l.nombre))
        expect(item, `la línea «${l.nombre}» no está en la cotización`).toBeDefined()
        const precio = Math.round(Number(item!.precio_venta) * (Number(item!.cantidad) || 1))
        expect(Math.abs(precio - l.precio), `«${l.nombre}»: ${precio} en vez de ${l.precio}`).toBeLessThanOrEqual(l.tolerancia ?? 2)
      }
    })

    prueba('I2', 'el margen con que se juzga cada opción es el margen general (D2)', () => {
      for (const s of caso.sujetos) {
        const esperado = margenEsperado(caso, s)
        const delMotor = r.sujetosDelMotor.find(m => mismoConjunto(m.lineas, s.lineas))
        expect(delMotor, `el motor no mide una opción con ${s.lineas.join(' + ')}`).toBeDefined()
        expect(Math.abs(delMotor!.total - esperado.cliente), `total ${delMotor!.total} en vez de ${esperado.cliente}`).toBeLessThanOrEqual(5)
        if (esperado.margenPct === null) expect(delMotor!.margen).toBeNull()
        else expect(delMotor!.margen, `margen de ${s.lineas.join(' + ')}`).not.toBeNull()
        if (esperado.margenPct !== null) expect(Math.abs(delMotor!.margen! - esperado.margenPct)).toBeLessThan(0.05)
      }
    })

    prueba('I3', 'nada bajo el piso sale limpio, y nada sano se frena por margen', () => {
      const bajo = algunoBajoElPiso(caso)
      if (bajo) expect(r.borrador, 'una opción bajo el piso salió sin marca de borrador').toBe(true)
      expect(r.medicion.bajoPiso.length > 0, 'la regla del piso no coincide con D2').toBe(bajo)
      const sinComision = caso.sujetos.some(s => margenEsperado(caso, s).publicasSinComision.length > 0)
      if (!bajo && !sinComision) expect(r.motivos).not.toContain('margen')
    })

    if (caso.lineas.some(l => l.tarifa === 'publica' && (l.comision === null || l.comision === undefined))) {
      prueba('I3b', 'una Pública sin comisión frena «Enviar» con su propio motivo (D3)', () => {
        expect(r.borrador).toBe(true)
        expect(r.motivos).toContain('comision_publica')
      })
    }

    prueba('I4', 'todas las opciones que van al cliente salen en el PDF, con su precio', () => {
      const delPdf = opcionesDelPdf(r.props)
      expect(delPdf.length).toBe(caso.sujetos.length)
      for (const s of caso.sujetos) {
        const o = delPdf.find(x => mismoConjunto(x.lineas, s.lineas))
        expect(o, `el PDF no muestra ${s.lineas.join(' + ')}`).toBeDefined()
        expect(Math.abs(o!.precio - margenEsperado(caso, s).cliente)).toBeLessThanOrEqual(5)
      }
    })

    if (caso.incluyeCasillas) {
      const casillas = caso.incluyeCasillas
      prueba('I5', '«Incluye» dice lo que marcan las casillas del paquete', () => {
        const incluye = r.modelo.precio.incluye.map(clave).join(' | ')
        for (const c of casillas.marcadas) expect(incluye, `falta «${c}» en «Incluye»`).toContain(clave(c))
        for (const c of casillas.noMarcadas) expect(incluye, `«${c}» no está marcado y sale en «Incluye»`).not.toContain(clave(c))
      })
    }

    prueba('I6', 'el régimen de alimentación no se afirma de más', () => {
      const todo = textoDelModelo(r.modelo)
      const afirma = /incluyen el desayuno|con desayuno/.test(todo)
      if (afirma) expect(caso.regimenes.every(soloDesayuno), 'dice «desayuno» de hoteles con otro régimen').toBe(true)
      // Lo que el documento dice de cada hotel es su régimen tal cual.
      const delDocumento = r.modelo.hoteles.flatMap(c => c.opciones.map(o => o.regimen ?? ''))
      for (const reg of delDocumento) expect(caso.regimenes.map(clave)).toContain(clave(reg))
    })

    prueba('I7', 'el día a día cubre todos los días del viaje', () => {
      expect(r.modelo.dias.length).toBe(caso.diasDelViaje)
      expect(r.modelo.dias[0]?.fecha).toBe(caso.viaje.fechas.inicio)
      expect(r.modelo.dias[r.modelo.dias.length - 1]?.fecha).toBe(caso.viaje.fechas.fin)
    })

    it('I8 · la foto del resumen no cambia sin que se vea en el PR', () => {
      const lineas = [...r.items]
        .sort((a, b) => Number(a.orden) - Number(b.orden))
        .map(i => ({ nombre: i.nombre, costo: i.subtotal, precio: i.precio_venta, margen: i.margen_porcentaje }))
      expect({
        valorTotal: r.valorTotal,
        lineas,
        opciones: r.sujetosDelMotor.map(s => ({ ...s, margen: s.margen === null ? null : Math.round(s.margen * 100) / 100 })),
        borrador: r.borrador,
        motivos: r.motivos,
        pdf: opcionesDelPdf(r.props),
        incluye: r.modelo.precio.incluye,
        intro: r.modelo.portada.intro,
        dias: r.modelo.dias.length,
      }).toMatchSnapshot()
    })

    // Lo que el oráculo da por hecho del caso: si el caso se edita mal, esto lo dice antes que las demás.
    it('el caso está bien escrito (cada opción nombra líneas declaradas)', () => {
      for (const s of caso.sujetos) for (const n of s.lineas) expect(() => lineaEsperada(caso, n)).not.toThrow()
    })
  })
}

// ── D5 y D3 con las acciones reales: quitar y volver a poner un paquete ──────

describe('D5 · la asesora saca un paquete de la propuesta y lo vuelve a poner (acciones reales)', () => {
  const caso = CASOS.find(c => c.clave === 'a-bloqueo-san-andres')!
  const idDe = (nombre: string) => (base.tablas.items as Fila[]).find(i => clave(i.nombre as string) === clave(nombre))!.id as string
  const opciones = (r: Resultado) => opcionesDelPdf(r.props).map(o => o.lineas.map(clave).join(' + '))
  let inicial: Resultado
  beforeAll(async () => { inicial = await correr(caso) }, 60_000)

  it('los tres paquetes salen, cada uno con su precio', () => {
    expect(opciones(inicial)).toEqual(['hotel arena ficticio', 'hotel coral ficticio', 'hotel palma ficticio'])
  })

  it('sacar el segundo lo quita del PDF sin borrarlo; ponerlo otra vez lo devuelve igual', async () => {
    const coral = idDe('Hotel Coral Ficticio')
    expect(await paqueteEnPropuesta(coral, false)).toEqual({ success: true })
    const sin = await medir(caso)
    expect(opciones(sin)).toEqual(['hotel arena ficticio', 'hotel palma ficticio'])
    expect((base.tablas.items as Fila[]).some(i => i.id === coral)).toBe(true)
    expect(await paqueteEnPropuesta(coral, true)).toEqual({ success: true })
    const con = await medir(caso)
    expect(opcionesDelPdf(con.props)).toEqual(opcionesDelPdf(inicial.props))
  }, 60_000)

  it('sacar el de la Recomendada le pasa la Recomendada al siguiente que va; el total es el de ese', async () => {
    const arena = idDe('Hotel Arena Ficticio')
    expect(await paqueteEnPropuesta(arena, false)).toEqual({ success: true })
    const r = await medir(caso)
    expect(opciones(r)).toEqual(['hotel coral ficticio', 'hotel palma ficticio'])
    const rec = r.props.itinerarios!.find(b => b.esPrincipal)!
    expect(rec.items.map(i => clave(i.nombre))).toEqual(['hotel coral ficticio'])
    expect(r.valorTotal).toBe(rec.precio)
    // Sin la Pública sin comisión en la propuesta, ya no frena por su comisión.
    expect(r.motivos).not.toContain('comision_publica')
    // Y vuelve.
    expect(await paqueteEnPropuesta(arena, true)).toEqual({ success: true })
    expect(opciones(await medir(caso))).toHaveLength(3)
  }, 60_000)

  it('el único paquete que va no se puede sacar', async () => {
    for (const n of ['Hotel Coral Ficticio', 'Hotel Palma Ficticio']) expect(await paqueteEnPropuesta(idDe(n), false)).toEqual({ success: true })
    const r = await paqueteEnPropuesta(idDe('Hotel Arena Ficticio'), false)
    expect(r.success).toBe(false)
    for (const n of ['Hotel Coral Ficticio', 'Hotel Palma Ficticio']) await paqueteEnPropuesta(idDe(n), true)
  }, 60_000)
})

describe('D3 · la comisión del paquete Público, en % o en pesos, levanta el freno (acciones reales)', () => {
  const caso = CASOS.find(c => c.clave === 'a-bloqueo-san-andres')!
  const arena = () => (base.tablas.items as Fila[]).find(i => clave(i.nombre as string) === 'hotel arena ficticio')!.id as string
  beforeAll(async () => { await correr(caso) }, 60_000)

  it('sin comisión frena; con 15 % entra al margen general con ella y el PDF sale limpio', async () => {
    expect((await medir(caso)).motivos).toEqual(['comision_publica'])
    expect(await ajustarReglasDelPaquete(arena(), { comisionPct: 15 })).toEqual({ success: true })
    const r = await medir(caso)
    expect(r.motivos).toEqual([])
    expect(r.borrador).toBe(false)
    const rec = r.sujetosDelMotor.find(s => s.nombre === 'Recomendada')!
    // Cliente 6.000.000; agencia 6.000.000 − 900.000.
    expect(rec.margen!).toBeCloseTo(15, 6)
  }, 60_000)

  it('en pesos: $300.000 sobre $6.000.000 es un 5 %: bajo el piso del 12 %, pide la autorización', async () => {
    expect(await ajustarReglasDelPaquete(arena(), { comisionMonto: 300_000 })).toEqual({ success: true })
    const r = await medir(caso)
    expect(r.sujetosDelMotor.find(s => s.nombre === 'Recomendada')!.margen!).toBeCloseTo(5, 6)
    expect(r.motivos).toEqual(['margen'])
  }, 60_000)

  it('«Guardar paquete» con la comisión escrita en la tarjeta la deja guardada (visible desde el inicio)', async () => {
    const item = (base.tablas.items as Fila[]).find(i => i.id === arena())!
    const paquete = (item.tarifa_pax as { bloqueo: unknown }).bloqueo
    const r = await guardarPaqueteBloqueo(arena(), { paquete: structuredClone(paquete), comision: 'incluida', comisionAgencia: { tipo: 'pct', valor: 20 } })
    expect(r.success).toBe(true)
    expect((item.tarifa_pax as { tipoTarifa: Record<string, unknown> }).tipoTarifa).toMatchObject({ tipo: 'publica', comisionPct: 20 })
    expect((item.tarifa_pax as { tipoTarifa: Record<string, unknown> }).tipoTarifa).not.toHaveProperty('comisionMonto')
  }, 60_000)
})

// ── QA en navegador del #1342 (2026-10-29): lo que vio la asesora, con las acciones reales ─────

describe('QA del #1342 · bloqueo con un paquete Público (acciones reales)', () => {
  const caso = CASOS.find(c => c.clave === 'a-bloqueo-san-andres')!
  const idDe = (nombre: string) => (base.tablas.items as Fila[]).find(i => clave(i.nombre as string) === clave(nombre))!.id as string
  const cot = () => (base.tablas.cotizaciones as Fila[]).find(c => c.id === caso.cotizacionId)!
  beforeAll(async () => { await correr(caso) }, 60_000)

  it('defecto 1 · el costo junto a «ganas» es lo que paga la agencia: precio público menos la comisión', async () => {
    const supabase = clienteFalso()
    const recomendada = async () => {
      const ctx = (await contextoDeCotizacion(supabase, caso.cotizacionId))!
      const filas = (await leerItinerarios(supabase, caso.cotizacionId))!
      const rec = filas.find(f => f.nombre === 'Recomendada')!
      return cascadaDeItinerario(ctx.items, rec.seleccion, ctx.params, rec.id)
    }
    // Sin comisión no se sabe lo que paga la agencia (D3): nada de «ganas $0».
    expect(costoDeAgencia(await recomendada())).toBeNull()
    expect(await ajustarReglasDelPaquete(idDe('Hotel Arena Ficticio'), { comisionMonto: 250_000 })).toEqual({ success: true })
    const c = await recomendada()
    expect(c.precioVenta).toBe(6_000_000)
    expect(costoDeAgencia(c)).toBe(5_750_000)
    expect(c.precioVenta - costoDeAgencia(c)!).toBe(250_000)
    // El costo de venta sigue siendo el precio público: lo que cambió es lo que se pinta.
    expect(c.costoDeVenta).toBe(6_000_000)
    expect(await ajustarReglasDelPaquete(idDe('Hotel Arena Ficticio'), { comisionMonto: null })).toEqual({ success: true })
  }, 60_000)

  it('defecto 5 · la pantalla nombra cada tarifa sin nombre como el documento («Opción 2», «Opción 3»)', async () => {
    const r = await medir(caso)
    const filas = (await leerItinerarios(clienteFalso(), caso.cotizacionId))!
    expect(filas.filter(f => f.nombre === null)).toHaveLength(2)
    const visibles = nombresVisiblesDeTarifas(filas)
    const delDocumento = [...r.modelo.tarifas].sort((a, b) => a.indice - b.indice).map(t => t.nombre)
    const tarifaDelBloque = (fs: typeof filas, b: { items: unknown[] }) => fs.find(f => f.seleccion.includes(idDe((b.items as LineaPdf[])[0].nombre)))!.id
    const enLaPantalla = (r.props.itinerarios ?? []).map(b => visibles.get(tarifaDelBloque(filas, b)))
    expect(enLaPantalla).toEqual(delDocumento)
    expect(enLaPantalla).toEqual(['Recomendada', 'Opción 2', 'Opción 3'])
    // Con el segundo fuera, el tercero es «Opción 2» en los dos lados.
    expect(await paqueteEnPropuesta(idDe('Hotel Coral Ficticio'), false)).toEqual({ success: true })
    const sin = await medir(caso)
    const filas2 = (await leerItinerarios(clienteFalso(), caso.cotizacionId))!
    const v2 = nombresVisiblesDeTarifas(filas2)
    expect((sin.props.itinerarios ?? []).map(b => v2.get(tarifaDelBloque(filas2, b))))
      .toEqual([...sin.modelo.tarifas].sort((a, b) => a.indice - b.indice).map(t => t.nombre))
    expect(await paqueteEnPropuesta(idDe('Hotel Coral Ficticio'), true)).toEqual({ success: true })
  }, 60_000)

  describe('defecto 3 · «Incluido» al final del PDF sin texto revisado', () => {
    const RECURSOS: RecursosPropuesta = { foto: () => null, fotoDeCiudad: () => null, logo: null, marca: 'Agencia de prueba' }
    const seccionIncluye = (r: Resultado) => {
      const h = htmlDePropuesta(r.modelo, RECURSOS)
      const i = h.indexOf('>Qué incluye')
      if (i < 0) return null
      return h.slice(i, h.indexOf('</section>', i)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    }
    const lasCasillas = ['Alimentación', 'Planes / tours', 'Traslados', 'Seguro médico']
    let documento: unknown
    beforeAll(() => {
      documento = cot().documento_cliente
      // El texto para el cliente lo escribió ONE y nadie lo revisó: lo que tenía la prueba real.
      // Sin la marca `incluye_origen` (un texto que nunca se guardó desde la forma por pasos).
      const { incluye_origen: _marca, ...sinMarca } = documento as Record<string, unknown>
      void _marca
      cot().documento_cliente = { ...sinMarca, revisado_por: null, revisado_por_nombre: null, revisado_en: null, origen: 'one' }
    })
    afterAll(async () => {
      cot().documento_cliente = documento
      for (const n of ['Hotel Arena Ficticio', 'Hotel Coral Ficticio', 'Hotel Palma Ficticio']) await paqueteEnPropuesta(idDe(n), true)
    })

    it('se reproduce: sin la pieza, una versión imprime solo el nombre del paquete y dos no imprimen la sección', async () => {
      expect(await paqueteEnPropuesta(idDe('Hotel Palma Ficticio'), false)).toEqual({ success: true })
      expect(await paqueteEnPropuesta(idDe('Hotel Coral Ficticio'), false)).toEqual({ success: true })
      expect(seccionIncluye(await medir(caso))).toContain('Incluido Hotel Arena Ficticio Asesora')
      expect(await paqueteEnPropuesta(idDe('Hotel Coral Ficticio'), true)).toEqual({ success: true })
      expect(seccionIncluye(await medir(caso))).toBeNull()
    }, 60_000)

    for (const [nombre, sacar] of [['una versión', ['Hotel Coral Ficticio', 'Hotel Palma Ficticio']], ['dos versiones', ['Hotel Palma Ficticio']], ['tres versiones', []]] as const) {
      it(`con la pieza encendida, ${nombre}: el hotel y cada casilla marcada del paquete`, async () => {
        for (const n of ['Hotel Arena Ficticio', 'Hotel Coral Ficticio', 'Hotel Palma Ficticio']) await paqueteEnPropuesta(idDe(n), true)
        for (const n of sacar) expect(await paqueteEnPropuesta(idDe(n), false)).toEqual({ success: true })
        const r = await medir(caso, { incluyePorOne: true })
        const seccion = seccionIncluye(r)
        expect(seccion, 'no hay sección «Qué incluye»').not.toBeNull()
        for (const c of lasCasillas) expect(seccion).toContain(c)
        expect(seccion).not.toContain('Tiquete aéreo')
        // El hotel: con una versión, el suyo con sus noches; con varias, el renglón que dice que cambia.
        if (sacar.length === 2) expect(seccion).toContain('5 noches en Hotel Arena Ficticio')
        else expect(seccion).toContain('5 noches de hotel; el hotel cambia según la versión')
        // El titular sin revisar no se imprime: solo «Incluye» lo arma ONE.
        expect(r.modelo.portada.titulo).not.toBe('Su viaje a San Andrés')
      }, 60_000)
    }

    it('con la marca `incluye_origen` y el texto sin revisar, también (sin que lo diga quien llama)', async () => {
      for (const n of ['Hotel Arena Ficticio', 'Hotel Coral Ficticio', 'Hotel Palma Ficticio']) await paqueteEnPropuesta(idDe(n), true)
      expect(await paqueteEnPropuesta(idDe('Hotel Palma Ficticio'), false)).toEqual({ success: true })
      const doc = cot().documento_cliente as Record<string, unknown>
      cot().documento_cliente = { ...doc, incluye_origen: 'one' }
      const seccion = seccionIncluye(await medir(caso))
      cot().documento_cliente = doc
      for (const c of lasCasillas) expect(seccion).toContain(c)
    }, 60_000)
  })

  describe('defecto 7 · sacar la Recomendada sin transacción nunca deja un paquete sin tarifa', () => {
    const estadoDeTarifas = async () => {
      const filas = (await leerItinerarios(clienteFalso(), caso.cotizacionId))!
      const paquetes = ['Hotel Arena Ficticio', 'Hotel Coral Ficticio', 'Hotel Palma Ficticio'].map(idDe)
      return filas
        .sort((a, b) => a.orden - b.orden)
        .map(f => ({ nombre: f.nombre, va: f.vaEnPropuesta, paquetes: f.seleccion.filter(id => paquetes.includes(id)) }))
    }
    afterEach(() => { base.fallar = null })

    const casos: [string, (tabla: string, op: string) => boolean][] = [
      ['falla el insert', (t, op) => t === 'itinerario_opciones' && op === 'insert'],
      ['falla el primer delete', (t, op) => t === 'itinerario_opciones' && op === 'delete'],
    ]
    for (const [nombre, fallar] of casos) {
      it(`${nombre}: todo queda como estaba y lo dice`, async () => {
        const antes = await estadoDeTarifas()
        // Una sola vez: lo que deshace el cambio sí se escribe.
        let ya = false
        base.fallar = (t, op) => !ya && fallar(t, op) && (ya = true)
        const r = await paqueteEnPropuesta(idDe('Hotel Arena Ficticio'), false)
        base.fallar = null
        expect(r.success).toBe(false)
        expect(await estadoDeTarifas()).toEqual(antes)
      }, 60_000)
    }

    it('falla el segundo delete: se deshace lo hecho y cada tarifa queda con su paquete', async () => {
      const antes = await estadoDeTarifas()
      let deletes = 0
      base.fallar = (t, op) => t === 'itinerario_opciones' && op === 'delete' && ++deletes === 2
      const r = await paqueteEnPropuesta(idDe('Hotel Arena Ficticio'), false)
      base.fallar = null
      expect(r.success).toBe(false)
      const despues = await estadoDeTarifas()
      expect(despues).toEqual(antes)
      for (const t of despues) expect(t.paquetes).toHaveLength(1)
    }, 60_000)

    it('sin fallas, la Recomendada pasa al siguiente y el sacado queda en una opción que no va', async () => {
      expect(await paqueteEnPropuesta(idDe('Hotel Arena Ficticio'), false)).toEqual({ success: true })
      const t = await estadoDeTarifas()
      for (const x of t) expect(x.paquetes).toHaveLength(1)
      expect(t.find(x => x.nombre === 'Recomendada')!.paquetes).toEqual([idDe('Hotel Coral Ficticio')])
      expect(t.find(x => x.paquetes[0] === idDe('Hotel Arena Ficticio'))!.va).toBe(false)
      expect(await paqueteEnPropuesta(idDe('Hotel Arena Ficticio'), true)).toEqual({ success: true })
    }, 60_000)
  })
})

// ── Prueba corta en navegador del #1352 (2026-10-29): tres paquetes con vuelo, sin zona ─────────

describe('Prueba corta del #1352 · bloqueo de tres paquetes, uno sin alimentación ni traslados (acciones reales)', () => {
  const caso = CASO_QA_1352 as unknown as CasoBateria
  const idDe = (nombre: string) => (base.tablas.items as Fila[]).find(i => clave(i.nombre as string) === clave(nombre))!.id as string
  const RECURSOS: RecursosPropuesta = { foto: () => null, fotoDeCiudad: () => null, logo: null, marca: 'Agencia de prueba' }
  const seccion = (h: string, titulo: string) => {
    const i = h.indexOf(`>${titulo}<`)
    return i < 0 ? null : h.slice(i, h.indexOf('</section>', i)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  }
  const opcion = (r: Resultado, hotel: string) => r.modelo.hoteles.flatMap(c => c.opciones).find(o => o.hotel === hotel)!
  const PAQUETES = ['Hotel Mar Azul Ficticio', 'Hotel Coral QA Ficticio', 'Hotel Brisa Ficticio']
  async function conEnPropuesta(van: string[]) {
    for (const n of PAQUETES) if (van.includes(n)) expect(await paqueteEnPropuesta(idDe(n), true)).toEqual({ success: true })
    for (const n of PAQUETES) if (!van.includes(n)) expect(await paqueteEnPropuesta(idDe(n), false)).toEqual({ success: true })
    return medir(caso, { incluyePorOne: true })
  }
  beforeAll(async () => { await correr(caso) }, 60_000)

  it('D2 · dos versiones: «Incluido en todas» es la intersección; lo de una sola va en su tarjeta', async () => {
    const r = await conEnPropuesta(['Hotel Mar Azul Ficticio', 'Hotel Brisa Ficticio'])
    expect(r.modelo.tarifas).toHaveLength(2)
    const incluye = r.modelo.precio.incluye
    // Brisa no trae alimentación ni traslados: no son «de todas».
    expect(incluye).not.toContain('Alimentación')
    expect(incluye).not.toContain('Traslados')
    // El seguro sí lo traen las dos.
    expect(incluye).toContain('Seguro médico')
    // El mismo vuelo en las dos versiones no «cambia según la versión».
    expect(incluye.join(' | ')).not.toMatch(/aerolínea cambia/)
    // Cada tarjeta dice lo suyo: Mar Azul lo que incluye; Brisa lo que no trae y la otra sí.
    expect(opcion(r, 'Hotel Mar Azul Ficticio').incluye).toBe('Alimentación, Traslados, Seguro médico')
    expect(opcion(r, 'Hotel Brisa Ficticio').incluye).toBe('Seguro médico')
    expect(opcion(r, 'Hotel Brisa Ficticio').noIncluye).toBe('Alimentación, Traslados')
    expect(opcion(r, 'Hotel Mar Azul Ficticio').noIncluye).toBeUndefined()
    const h = htmlDePropuesta(r.modelo, RECURSOS)
    const hospedaje = seccion(h, 'Hospedaje')!
    // «Desayuno en todos los hoteles» con un hotel sin alimentación era falso.
    expect(hospedaje).not.toContain('en todos los hoteles')
    expect(hospedaje).toContain('No incluye Alimentación, Traslados')
    expect(seccion(h, 'Qué incluye')).not.toMatch(/Traslados/)
  }, 60_000)

  it('D3 · dos versiones sin zona (no hay paradas): el renglón del hotel lleva las noches', async () => {
    const r = await conEnPropuesta(['Hotel Mar Azul Ficticio', 'Hotel Brisa Ficticio'])
    // La causa: sin ciudad no había paradas y las noches de la ruta daban 0 («Hoteles; …»). Desde el
    // QA G7 (V6) el paquete sin ciudad duerme en el destino del viaje: una parada, sin la zona.
    expect(r.modelo.ruta.paradas.map(p => p.ciudad)).toEqual(['San Andrés'])
    expect(r.modelo.precio.incluye).toContain('4 noches de hotel; el hotel cambia según la versión')
    expect(r.modelo.precio.incluye.some(x => x.startsWith('Hoteles;'))).toBe(false)
  }, 60_000)

  it('tres versiones: Coral trae lo mismo que Mar Azul; Brisa sigue sin alimentación ni traslados', async () => {
    const r = await conEnPropuesta(PAQUETES)
    expect(r.modelo.tarifas).toHaveLength(3)
    expect(r.modelo.precio.incluye).not.toContain('Traslados')
    expect(r.modelo.precio.incluye).toContain('Seguro médico')
    expect(opcion(r, 'Hotel Brisa Ficticio').noIncluye).toBe('Alimentación, Traslados')
  }, 60_000)

  it('una versión: como siempre, el hotel con sus noches y todas sus casillas en «Incluido»', async () => {
    const r = await conEnPropuesta(['Hotel Mar Azul Ficticio'])
    const incluye = r.modelo.precio.incluye
    expect(incluye.some(x => x.startsWith('4 noches en Hotel Mar Azul Ficticio'))).toBe(true)
    for (const c of ['Alimentación', 'Traslados', 'Seguro médico']) expect(incluye).toContain(c)
    expect(opcion(r, 'Hotel Mar Azul Ficticio').noIncluye).toBeUndefined()
  }, 60_000)

  it('menor · «Opción N» en el mismo orden en «Tarifas» y en el PDF (la que no va, al final)', async () => {
    const r = await conEnPropuesta(['Hotel Mar Azul Ficticio', 'Hotel Brisa Ficticio'])
    const supabase = clienteFalso()
    const ctx = (await contextoDeCotizacion(supabase, caso.cotizacionId))!
    const filas = (await leerItinerarios(supabase, caso.cotizacionId))!
    const pantalla = tarifasCalculadas(ctx.items as never, ctx.params, filas)
    // Coral (no va) tiene `orden` 2: antes salía «Opción 3» arriba de «Opción 2».
    expect(pantalla.map(t => t.nombre)).toEqual(['Recomendada', 'Opción 2', 'Opción 3'])
    const paqueteDe = (t: { seleccion: string[] }) => PAQUETES.find(n => t.seleccion.includes(idDe(n)))
    expect(pantalla.map(paqueteDe)).toEqual(['Hotel Mar Azul Ficticio', 'Hotel Brisa Ficticio', 'Hotel Coral QA Ficticio'])
    // El PDF numera igual las que van.
    const delPdf = [...r.modelo.tarifas].sort((a, b) => a.indice - b.indice).map(t => t.nombre)
    expect(delPdf).toEqual(['Recomendada', 'Opción 2'])
    expect((r.props.itinerarios ?? []).map(b => clave((b.items as LineaPdf[])[0].nombre))).toEqual(['hotel mar azul ficticio', 'hotel brisa ficticio'])
  }, 60_000)

  it('menor · «Falta la comisión…» nombra el paquete como su tarjeta (no «Hotel Coral Qa Ficticio»)', async () => {
    const r = await conEnPropuesta(PAQUETES)
    expect(r.motivos).toContain('comision_publica')
    const items = (base.tablas.items as Fila[]).filter(i => i.cotizacion_id === caso.cotizacionId)
    const coral = items.find(i => i.id === idDe('Hotel Coral QA Ficticio'))!
    // La línea guarda el nombre en mayúscula: así nacía el «Qa».
    expect(coral.nombre).toBe('HOTEL CORAL QA FICTICIO')
    const lista = publicasSinComisionQueSalen(items.map(i => ({ id: i.id as string, nombre: i.nombre as string, tarifa_pax: i.tarifa_pax })), new Set(items.map(i => i.id as string)))
    expect(lista).toEqual([{ itemId: coral.id, nombre: 'Hotel Coral QA Ficticio' }])
    expect(motivoPublicasSinComision(lista)).toContain('«Hotel Coral QA Ficticio»')
  }, 60_000)

  it('menor · los créditos de las fotos van en la fila de la firma: no abren una hoja casi vacía', async () => {
    const r = await conEnPropuesta(['Hotel Mar Azul Ficticio', 'Hotel Brisa Ficticio'])
    expect(r.modelo.formal.creditos.length).toBeGreaterThan(0)
    const h = htmlDePropuesta(r.modelo, RECURSOS)
    // La firma va en el último bloque que no se parte; los créditos, en su misma fila (entre el nombre
    // de la asesora y la marca), una sola vez. Con Chromium (QA, fuera de CI) el caso que dejaba los
    // créditos solos en una 3.ª hoja sale en 2.
    expect((h.match(/class="credits"/g) ?? []).length).toBe(1)
    expect(h).toMatch(/<div class="sign">\s*<div>(?:(?!<\/div>)[\s\S])*<\/div>\s*<div class="credits"><b>Fotografías:<\/b>/)
  }, 60_000)
})

// ── Prueba real del #1359 (2026-10-29): tres paquetes, uno de 4 noches, y la Recomendada que cambia ──

describe('Prueba real del #1359 · bloqueo de tres paquetes (acciones reales)', () => {
  const caso = CASO_QA_1359 as unknown as CasoBateria
  const idDe = (nombre: string) => (base.tablas.items as Fila[]).find(i => clave(i.nombre as string) === clave(nombre))!.id as string
  const RECURSOS: RecursosPropuesta = { foto: () => null, fotoDeCiudad: () => null, logo: null, marca: 'Agencia de prueba' }
  const GAVIOTA = 'Hotel Gaviota Ficticio'
  const SOL = 'Hotel Sol Ficticio'
  const DECAMAR = 'Hotel Decamar Ficticio'
  const PAQUETES = [GAVIOTA, SOL, DECAMAR]
  /** Cada paquete: si va, y si es el de la Recomendada. */
  const estadoDeLosPaquetes = async () => {
    const filas = (await leerItinerarios(clienteFalso(), caso.cotizacionId))!
    const out: Record<string, 'recomendada' | 'va' | 'no va'> = {}
    for (const n of PAQUETES) {
      const t = filas.filter(f => f.seleccion.includes(idDe(n)))
      expect(t, `«${n}» está en ${t.length} tarifas`).toHaveLength(1)
      out[n] = t[0].nombre === 'Recomendada' ? 'recomendada' : t[0].vaEnPropuesta ? 'va' : 'no va'
    }
    return out
  }
  const tarifaDe = async (n: string) => (await leerItinerarios(clienteFalso(), caso.cotizacionId))!.find(f => f.seleccion.includes(idDe(n)))!
  const recomendada = async () => (await leerItinerarios(clienteFalso(), caso.cotizacionId))!.find(f => f.nombre === 'Recomendada')!
  const grupo = () => (base.tablas.items as Fila[]).find(i => i.id === idDe(GAVIOTA))!.grupo as string
  beforeEach(async () => { await correr(caso) }, 60_000)

  it('defecto 1 · cada versión con sus fechas y sus noches en «Hospedaje» (4 y 5 noches)', async () => {
    // Dos versiones, como la prueba real: la Recomendada es de 5 noches y la Opción 2, de 4.
    expect(await paqueteEnPropuesta(idDe(DECAMAR), false)).toEqual({ success: true })
    const r = await medir(caso)
    const h = htmlDePropuesta(r.modelo, RECURSOS)
    const tarjeta = (hotel: string) => {
      const i = h.indexOf(`>${hotel}<`)
      expect(i, `no está la tarjeta de ${hotel}`).toBeGreaterThan(0)
      const desde = h.lastIndexOf('<div class="hc">', i)
      return h.slice(desde, h.indexOf('<div class="hc">', i) < 0 ? undefined : h.indexOf('<div class="hc">', i)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
    }
    expect(r.modelo.tarifas).toHaveLength(2)
    expect(tarjeta(SOL)).toContain('Estancia 18 – 22 dic (4 noches)')
    expect(tarjeta(GAVIOTA)).toContain('Estancia 18 – 23 dic (5 noches)')
    // La de la Recomendada no lleva estancia propia (es la del capítulo); la de 4 noches sí.
    const opciones = r.modelo.hoteles.flatMap(c => c.opciones)
    expect(opciones.find(o => o.hotel === GAVIOTA)!.estancia).toBeUndefined()
    expect(opciones.find(o => o.hotel === SOL)!.estancia).toEqual({ desde: '2026-12-18', hasta: '2026-12-22', noches: 4 })
  }, 60_000)

  it('defecto 4 · en el día a día cada regreso cae en su día y dice de qué versión es; la ida común sale una vez', async () => {
    // Recomendada (Gaviota) regresa el 23; la Opción 2 (Sol), el 22. Antes el del 22 salía como de todas.
    expect(await paqueteEnPropuesta(idDe(DECAMAR), false)).toEqual({ success: true })
    const r = await medir(caso)
    const indice = (nombre: string) => r.modelo.tarifas.find(t => t.nombre === nombre)!.indice
    const vuelosDe = (fecha: string) => r.modelo.dias.find(d => d.fecha === fecha)!.eventos.filter(e => e.tipo === 'vuelo')
    // La ida es la misma en las dos: una vez y sin versión.
    expect(vuelosDe('2026-12-18')).toHaveLength(1)
    expect(vuelosDe('2026-12-18')[0].tarifas).toBeUndefined()
    // Cada regreso, en su día y con su versión.
    expect(vuelosDe('2026-12-22').map(e => e.tarifas)).toEqual([[indice('Opción 2')]])
    expect(vuelosDe('2026-12-23').map(e => e.tarifas)).toEqual([[indice('Recomendada')]])
    // El documento lo dice en el renglón y en el título del día.
    for (const compacto of [false, true]) {
      const texto = htmlDePropuesta(r.modelo, RECURSOS, { compacto }).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
      // Un día: desde su «DÍA n» hasta el siguiente día (o bloque «DÍAS») o el fin del itinerario.
      const dia = (n: number) => {
        const desde = texto.indexOf(`DÍA ${n} `)
        const fin = [texto.indexOf(' DÍA', desde + 4), texto.indexOf('Elijan su versión', desde)].filter(x => x > 0)
        return texto.slice(desde, Math.min(...fin))
      }
      expect(dia(5)).toContain('Regreso a casa (Opción 2)')
      expect(dia(5)).toMatch(/Opción 2 : regreso/)
      expect(dia(5)).not.toContain('Recomendada')
      expect(dia(6)).toContain('Regreso a casa (Recomendada)')
      expect(dia(6)).toMatch(/Recomendada : regreso/)
      expect(dia(1)).not.toMatch(/Opción 2|Recomendada/)
    }
  }, 60_000)

  // Defecto 2 · Chromium no corre en CI: con `CHROMIUM_EJECUTABLE` (la torre) se mide el PDF impreso.
  it.skipIf(!process.env.CHROMIUM_EJECUTABLE)('defecto 2 · con Chromium, dos versiones caben en dos hojas (sin la tercera casi vacía)', async () => {
    expect(await paqueteEnPropuesta(idDe(DECAMAR), false)).toEqual({ success: true })
    estado.chromium = true
    try {
      await medir(caso)
    } finally {
      estado.chromium = false
    }
    const { hojasDelPdf } = await import('@/lib/pdf/chromium/render-chromium')
    expect(await hojasDelPdf(estado.impreso!.pdf)).toBe(2)
    // Normal salía en 3; la compacta (días libres juntos) cabe en 2 y es la que sale.
    expect(estado.impreso!.hojas).toEqual({ primera: 3, alternativa: 2, gano: 'alternativa' })
    expect(estado.impreso!.html).toContain('<small>DÍAS</small>2–4')
  }, 60_000)

  it('defecto 3 · sacar la Recomendada y escoger una tercera como Recomendada deja cada marca con su paquete', async () => {
    expect(await estadoDeLosPaquetes()).toEqual({ [GAVIOTA]: 'recomendada', [SOL]: 'va', [DECAMAR]: 'va' })
    // 1. Sacar Gaviota (la Recomendada): la Recomendada pasa al siguiente que va.
    expect(await paqueteEnPropuesta(idDe(GAVIOTA), false)).toEqual({ success: true })
    expect(await estadoDeLosPaquetes()).toEqual({ [GAVIOTA]: 'no va', [SOL]: 'recomendada', [DECAMAR]: 'va' })
    // 2. Escoger Decamar como Recomendada (en su pestaña): Sol, que iba, sigue yendo; Gaviota sigue fuera.
    const r = await elegirOpcionEnTarifa((await recomendada()).id, grupo(), idDe(DECAMAR))
    expect(r.success).toBe(true)
    expect(await estadoDeLosPaquetes()).toEqual({ [GAVIOTA]: 'no va', [SOL]: 'va', [DECAMAR]: 'recomendada' })
    // El PDF manda los dos que van.
    const m = await medir(caso)
    expect((m.props.itinerarios ?? []).map(b => clave((b.items as LineaPdf[])[0].nombre)).sort()).toEqual([clave(DECAMAR), clave(SOL)].sort())
  }, 60_000)

  it('defecto 3 · se reproduce (prueba real): escoger como Recomendada el paquete que se sacó lo mete; el que deja la Recomendada sigue yendo', async () => {
    expect(await paqueteEnPropuesta(idDe(GAVIOTA), false)).toEqual({ success: true })
    expect((await elegirOpcionEnTarifa((await recomendada()).id, grupo(), idDe(GAVIOTA))).success).toBe(true)
    expect(await estadoDeLosPaquetes()).toEqual({ [GAVIOTA]: 'recomendada', [SOL]: 'va', [DECAMAR]: 'va' })
  }, 60_000)

  it('defecto 3 · entre dos opciones (sin la Recomendada) la marca también sigue al paquete, y «Deshacer» la devuelve', async () => {
    expect(await paqueteEnPropuesta(idDe(SOL), false)).toEqual({ success: true })
    expect(await estadoDeLosPaquetes()).toEqual({ [GAVIOTA]: 'recomendada', [SOL]: 'no va', [DECAMAR]: 'va' })
    // En la tarifa de Decamar (la de mayor orden) se escoge Sol: antes se deshacía sola (ganaba la de menor orden).
    const deDecamar = await tarifaDe(DECAMAR)
    const r = await elegirOpcionEnTarifa(deDecamar.id, grupo(), idDe(SOL))
    expect(r.success).toBe(true)
    expect((await tarifaDe(SOL)).id).toBe(deDecamar.id)
    expect(await estadoDeLosPaquetes()).toEqual({ [GAVIOTA]: 'recomendada', [SOL]: 'no va', [DECAMAR]: 'va' })
    // Deshacer: cada paquete vuelve a su tarifa, con su marca.
    if (!r.success) return
    const d = await deshacerPorPasos({ tipo: 'eleccion', cotizacionId: caso.cotizacionId, itinerarioId: deDecamar.id, grupo: grupo(), escrita: idDe(SOL), anterior: r.anterior })
    expect(d.success).toBe(true)
    expect((await tarifaDe(DECAMAR)).id).toBe(deDecamar.id)
    expect(await estadoDeLosPaquetes()).toEqual({ [GAVIOTA]: 'recomendada', [SOL]: 'no va', [DECAMAR]: 'va' })
  }, 60_000)

  it('defecto 3 · un paquete nuevo va en la propuesta aunque su tarifa viniera de un paquete fuera', async () => {
    expect(await paqueteEnPropuesta(idDe(SOL), false)).toEqual({ success: true })
    const creado = await crearPaqueteBloqueo(caso.cotizacionId)
    expect(creado.success).toBe(true)
    if (!creado.success) return
    const filas = (await leerItinerarios(clienteFalso(), caso.cotizacionId))!
    expect(filas.find(f => f.seleccion.includes(creado.itemId))!.vaEnPropuesta).toBe(true)
    expect(await estadoDeLosPaquetes()).toEqual({ [GAVIOTA]: 'recomendada', [SOL]: 'no va', [DECAMAR]: 'va' })
  }, 60_000)
})
