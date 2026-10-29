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
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/cotizacion-pdf-doble'
import { CASOS, type CasoBateria, type ClaveCaso } from '@/lib/cotizaciones/__fixtures__/bateria/casos'
import { algunoBajoElPiso, clave, lineaEsperada, margenEsperado, soloDesayuno } from '@/lib/cotizaciones/__fixtures__/bateria/oraculo'
import { modeloDePropuesta, type EntradaModeloPropuesta, type ModeloPropuesta } from '@/lib/cotizaciones/propuesta/modelo-documento'
import type { CotizacionPDFProps } from '@/lib/pdf/cotizacion-props'
import type { MedicionDeSalida } from '@/lib/cotizaciones/piso-salida'

const estado = vi.hoisted(() => ({
  caso: null as null | { viaje: CasoBateria['viaje']; bloqueo: boolean },
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
vi.mock('@/lib/pdf/html/propuesta-html', () => ({
  pdfDePropuestaHtml: async (entrada: unknown) => {
    estado.motor.push(entrada)
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
import { crearPaqueteBloqueo, guardarPaqueteBloqueo } from './bloqueo-actions'
import { cascadaVigente, contextoDeCotizacion, leerItinerarios } from '@/lib/cotizaciones/itinerarios-datos'
import { itemsDelItinerario } from '@/lib/cotizaciones/itinerarios'
import { medirSalida } from '@/lib/cotizaciones/piso-salida'

// ── Lo que hoy falla, y por qué decisión ─────────────────────────────────────

type Invariante = 'I1' | 'I2' | 'I3' | 'I3b' | 'I4' | 'I5' | 'I6' | 'I7'

/**
 * Casos × invariantes que HOY no cumplen la decisión que los nombra. Cada uno corre con `it.fails`:
 * pasa mientras siga fallando. Al arreglar la decisión, se borra de aquí (el `it.fails` se pondría
 * rojo al dejar de fallar).
 */
const FALLA_HOY: Partial<Record<ClaveCaso, Partial<Record<Invariante, string>>>> = {
  'a-bloqueo-san-andres': {
    // D4: el 0 de `cotizaciones.margen_porcentaje` (nadie lo escribió a propósito) anula el 15 de la
    // línea y las dos Netas salen a costo (`cotizacion-actions.ts`, `itinerarios-datos.ts`).
    I1: 'D4 (un 0 en la cotización anula el margen por defecto: las Netas salen a costo)',
    // D2 + D5: solo se mide el primer paquete (el supuesto), y como es Público queda exento.
    I2: 'D2 (exención de las Públicas) y D5 (solo se mide el primer paquete)',
    // D2: con solo el paquete Público en la cuenta, `exentaDelMinimo` deja salir el PDF limpio.
    I3: 'D2 (la cotización «solo Pública» queda exenta del mínimo y sale limpia)',
    I3b: 'D3 (la Pública sin comisión no tiene motivo propio; hoy ni siquiera frena)',
    // D5: crear/guardar paquete no sincroniza las tarifas; el PDF muestra solo el primer paquete.
    I4: 'D5 (el PDF muestra solo el primer paquete)',
    // D6: «Incluye» (`incluye-por-one.ts`) no mira `bloqueo.incluye.casillas`.
    I5: 'D6 («Incluye» no refleja las casillas del paquete)',
    // D6: «Todos los hoteles incluyen el desayuno» con «(FULL) Desayuno, Almuer.».
    I6: 'D6 (afirma «incluyen el desayuno» con un régimen FULL)',
    // D6: sin vuelo ni salida manual el paquete no tiene fechas y el itinerario sale de 1 día.
    I7: 'D6 (paquete sin vuelo ni salida: itinerario de 1 día)',
  },
  'b-cancun-publicas': {
    // D2: las Públicas sin comisión salen de la medida y el margen se calcula solo con las Netas.
    I2: 'D2 (las Públicas sin comisión no entran al margen general)',
    I3b: 'D3 (la Pública sin comisión frena como «margen bajo el mínimo», no por su motivo)',
  },
}

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

  const r = (await generateCotizacionPDF(caso.cotizacionId, { vistaPrevia: true, porPasos: true })) as { success: boolean; error?: string; borrador?: boolean }
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
