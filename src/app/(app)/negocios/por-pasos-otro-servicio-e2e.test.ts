/**
 * «OTRO SERVICIO» (asistencia médica, seguro de viaje…) en la cotización por pasos, contra el doble
 * de igualdad de C0 y el caso fijo de San Andrés. Migración `20261013140000_cotizacion_ranuras_tipo_otro`.
 *
 *  · Escrito a mano: entra a la bandeja y, al aceptar, abre su propia ranura «otro» con el nombre
 *    del servicio, marcada «a mano», que SUMA en cada tarifa.
 *  · Ida y vuelta: lo armado con el interruptor encendido se abre, suma, imprime y se aprueba
 *    igual con el interruptor apagado.
 *  · Se lee bien en todo lector: recálculo, Tarifas, «Incluye» de ONE (C6), PDF, servicios del
 *    viaje y «Documentos del viajero».
 *  · Asistencia médica (escrita o leída de un pantallazo) queda marcada; un seguro no.
 *  · N5: con el interruptor apagado, escribirlo, leerlo, aceptarlo o abrir su ranura se rechaza
 *    sin escribir.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, escrituras, tomarRegistro, type Fila } from '../../../../test/igualdad-servidor-doble'
import { COT_SAN_ANDRES, NEG_SAN_ANDRES, WS_TRAPPVEL } from '../../../../test/caso-san-andres'
import { tablasPorPasos, type OpcionesPorPasos } from '../../../../test/caso-por-pasos'
import { leerPlata, ponerInterruptor } from '../../../../test/por-pasos-lectura'
import { onceDelCasoFijo, type Pantallazo } from '../../../../test/caso-once-pantallazos'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/actions/get-workspace', async () => {
  const { memoDeRuta } = await import('@/lib/actions/memo-de-ruta')
  return {
    getWorkspace: memoDeRuta(async () => ({
      supabase: clienteFalso(), workspaceId: WS_TRAPPVEL, userId: 'p-asesora', staffId: 's-asesora',
      role: 'operator', areas: [], impersonating: false, realRole: 'operator', error: null,
    })),
  }
})
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))
vi.mock('@/lib/modulos/exigir-modulo', () => ({
  exigirModulo: async () => ({ ok: true }),
  MENSAJE_MODULO_NO_ACTIVO: 'sin módulo',
  REQUISITO: { clarity: 'clarity' },
}))
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => true }))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({
  almacenamientoExternoDe: async () => ({
    subirArchivo: async (a: { nombre: string }) => ({ referencia: `sbext://one-documentos/${a.nombre}`, path: '', bytes: 0, sha256: '' }),
  }),
}))
vi.mock('@/lib/google-drive', () => ({
  uploadFileToDrive: async () => { throw new Error('Drive no debe llamarse') },
  createDriveFolder: async () => { throw new Error('Drive no debe llamarse') },
}))
vi.mock('@/lib/pdf/pdf-render-client', () => ({
  isPdfRenderConfigured: () => false,
  renderViaService: async () => { throw new Error('no debería llamarse') },
}))
vi.mock('@/app/(app)/negocios/[id]/vista-negocio', () => ({ cargarVistaNegocio: async () => null }))
const captura = vi.hoisted(() => ({ activa: false, props: null as unknown }))
vi.mock('@/lib/pdf/plantillas-cotizacion', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/pdf/plantillas-cotizacion')>()
  return {
    ...real,
    compositorDePlantilla: (slug: string | null | undefined) => {
      const c = real.compositorDePlantilla(slug)
      if (!c) return null
      return async (props: Parameters<typeof c>[0]) => {
        if (captura.activa && captura.props === null) captura.props = props
        return c(props)
      }
    },
  }
})
// La lectura del pantallazo (Gemini) no corre en pruebas: devuelve la de una asistencia médica
// leída de la cotización del proveedor (sin la marca «a mano» ni la de asistencia: las pone ONE).
const lecturaPantallazo = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@/lib/cotizaciones/leer-imagen-captura', async () => {
  const { leer: leerManual } = await import('../../../../test/caso-once-pantallazos')
  return {
    leerImagenDeCaptura: async () => {
      lecturaPantallazo.calls += 1
      const l = leerManual({ tipo: 'otro', datos: { nombre: 'Asistencia al viajero', proveedor: 'Universal Assistance', adultos: 6, ninos: 1, infantes: 1, cobro: 'por_persona', neto: 52_000, fuente: '' } })
      delete l.origen
      delete l.manual
      delete l.asistenciaMedica
      return { ok: true, leida: l }
    },
  }
})
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))

import { recalcularTotales } from './cotizacion-actions'
import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { aceptarCotizacionNegocio, opcionesDeAprobacion } from './[id]/cotizacion/actions'
import { crearRanuraConOpcion } from './ranura-actions'
import { firmarBorrador } from '@/lib/cotizaciones/firma-borrador'
import { decisionParaAceptar, destinoDeReglas } from '@/lib/cotizaciones/destino-por-pasos'
import { normalizarGrupo } from '@/lib/cotizaciones/itinerarios'
import { etiquetaDeRanura } from '@/lib/cotizaciones/ranuras-pantallazo'
import { estadosPermitidos } from '@/lib/cotizaciones/estado-servicio'
import { filasDeServicioDeTarifa } from '@/lib/viaje/servicios-desde-tarifa'
import { asistenciasDelViaje } from '@/lib/viaje/entrega'
import type { LecturaCasilla } from '@/lib/cotizaciones/tarifa-pasajero'
import { POST as aceptarLote } from '@/app/api/cotizaciones/[id]/aceptar-lote/route'
import { POST as aceptarUno } from '@/app/api/cotizaciones/[id]/aceptar-captura/route'
import { POST as lecturaManualRuta } from '@/app/api/cotizaciones/[id]/lectura-manual/route'
import { POST as leerCapturaRuta } from '@/app/api/cotizaciones/[id]/leer-captura/route'

const LECTORES = { recalcularTotales, generateCotizacionPDF, opcionesDeAprobacion, aceptarCotizacionNegocio }
const tabla = (t: string) => base.tablas[t] ?? []
const VIAJE = { adultos: 6, ninos: 1, infantes: 1 }
const SIN_PISTAS = { lugar: null, origen: null, destino: null }

const ASISTENCIA = { nombre: 'Asistencia médica', proveedor: 'Assist Card, plan Básico', ...VIAJE, cobro: 'por_persona', neto: '45.000', fuente: '' }
const SEGURO = { nombre: 'Seguro de viaje', proveedor: '', ...VIAJE, cobro: 'total', neto: '120.000', fuente: 'Llamada con la aseguradora' }

beforeAll(() => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
})

function sembrarVacia(o: OpcionesPorPasos = {}) {
  base.tablas = tablasPorPasos(o)
  base.tablas.items = []
  base.tablas.rubros = []
  base.tablas.cotizacion_itinerarios = []
  base.tablas.itinerario_opciones = []
  base.tablas.cotizacion_ranuras = []
  base.secuencia = 0
  base.registro = []
}

function borrador(p: Pantallazo, decision: string = 'auto', destinoId: string | null = null) {
  const lecturaJson = JSON.stringify(p.lectura)
  return {
    tipo: p.tipo, lecturaJson, firma: firmarBorrador(COT_SAN_ANDRES, p.tipo, lecturaJson)!,
    pistas: p.pistas, decision, destinoId, imagen: null, correcciones: null, idAceptacion: p.id,
  }
}

async function postLote(filas: unknown[]) {
  const res = await aceptarLote(
    new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/aceptar-lote`, { method: 'POST', body: JSON.stringify({ filas }) }),
    { params: Promise.resolve({ id: COT_SAN_ANDRES }) },
  )
  return (await res.json()) as { ok: boolean; codigo?: string; mensaje?: string; resultados?: { id: string; resultado: { ok: boolean; itemId?: string; como?: string; mensaje?: string; bloque?: string } }[] }
}

const ruta = (accion: string, cuerpo: unknown) => new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/${accion}`, { method: 'POST', body: JSON.stringify(cuerpo) })
const params = { params: Promise.resolve({ id: COT_SAN_ANDRES }) }

async function escribirAMano(datos: Record<string, unknown>, porPasos = true) {
  const res = await lecturaManualRuta(ruta('lectura-manual', { tipo: 'otro', datos, ...(porPasos ? { porPasos: true } : {}) }), params)
  return { status: res.status, cuerpo: (await res.json()) as { ok: boolean; codigo?: string; lectura?: LecturaCasilla; lecturaJson?: string; firma?: string } }
}

/** Los 11 del caso fijo, aceptados en lote como los deja la bandeja. */
async function caso11() {
  const filas = onceDelCasoFijo().map(p => {
    const d = decisionParaAceptar(destinoDeReglas({ tipo: p.tipo, lectura: p.lectura, pistas: p.pistas, lineas: [], grupoViaje: VIAJE }))
    if (p.id === 'cap-caso-10') return { id: p.id, borrador: borrador(p, 'hermana'), destinoCaptura: 'cap-caso-09' }
    return { id: p.id, borrador: borrador(p, d.decision, d.destinoId) }
  })
  const r = await postLote(filas)
  expect(r.ok, r.mensaje).toBe(true)
}

/** Escribe a mano y acepta, con la frase que diría la bandeja. Devuelve el id de la opción. */
async function otroAceptado(id: string, datos: Record<string, unknown>): Promise<string> {
  const { cuerpo } = await escribirAMano(datos)
  expect(cuerpo.ok).toBe(true)
  const p: Pantallazo = { id, tipo: 'otro', lectura: cuerpo.lectura!, pistas: SIN_PISTAS }
  const d = destinoDeReglas({ tipo: 'otro', lectura: p.lectura, pistas: SIN_PISTAS, lineas: tabla('items') as never, grupoViaje: VIAJE })
  // Cada otro servicio suma aparte: nunca compite con otro.
  expect(d.como).toBe('nueva')
  const { decision, destinoId } = decisionParaAceptar(d)
  const r = await postLote([{ id, borrador: borrador(p, decision, destinoId) }])
  expect(r.resultados![0].resultado.ok, r.resultados![0].resultado.mensaje).toBe(true)
  return r.resultados![0].resultado.itemId!
}

const precioDeTarifas = (r: unknown) => Object.fromEntries(
  ((r as { opciones?: { nombre: string; precio: number }[] }).opciones ?? []).map(o => [o.nombre, o.precio]),
)

describe('«Otro servicio» escrito a mano', () => {
  it('la asistencia médica entra por la bandeja, abre su ranura «otro» con su nombre y queda marcada', async () => {
    sembrarVacia()
    const { cuerpo } = await escribirAMano(ASISTENCIA)
    expect(cuerpo.ok).toBe(true)
    expect(cuerpo.lectura).toMatchObject({ origen: 'manual', asistenciaMedica: true, nombre: 'Asistencia médica', total: 360_000 })

    const itemId = await otroAceptado('cap-asistencia', ASISTENCIA)
    const linea = tabla('items').find(i => i.id === itemId)!
    expect(linea.grupo).toBe('otro: Asistencia médica')
    expect(linea.nombre).toBe('ASISTENCIA MÉDICA')
    expect(etiquetaDeRanura(linea.grupo as string)).toBe('Asistencia médica')
    const ranura = tabla('cotizacion_ranuras').find(r => r.id === linea.ranura_id)!
    expect(ranura).toMatchObject({ tipo: 'otro', nombre: 'Asistencia médica', numero: null })
    // El mismo desplegable de estado que un traslado o una actividad.
    expect(estadosPermitidos(linea.grupo as string)).toEqual(['incluido', 'opcional', 'no'])
  }, 60_000)

  it('un seguro por todo el viaje es otro servicio aparte, sin la marca; dos iguales no se llaman igual', async () => {
    sembrarVacia()
    const { cuerpo } = await escribirAMano(SEGURO)
    expect(cuerpo.ok, JSON.stringify(cuerpo)).toBe(true)
    expect(cuerpo.lectura).toMatchObject({ total: 120_000 })
    expect(cuerpo.lectura!.asistenciaMedica).toBeUndefined()
    const a = await otroAceptado('cap-asistencia', ASISTENCIA)
    const s = await otroAceptado('cap-seguro', SEGURO)
    const b = await otroAceptado('cap-asistencia-2', ASISTENCIA)
    const grupo = (id: string) => normalizarGrupo(tabla('items').find(i => i.id === id)!.grupo as string)
    expect([grupo(a), grupo(s), grupo(b)]).toEqual(['otro: Asistencia médica', 'otro 2: Seguro de viaje', 'otro 3: Asistencia médica 2'])
  }, 60_000)

  it('sin nombre o sin costo no se lleva a la bandeja', async () => {
    sembrarVacia()
    const { cuerpo } = await escribirAMano({ ...ASISTENCIA, nombre: '', neto: '' })
    expect(cuerpo).toMatchObject({ ok: false, codigo: 'CAMPOS' })
    expect(Object.keys((cuerpo as { errores?: object }).errores ?? {}).sort()).toEqual(['neto', 'nombre'])
  })
})

describe('«Otro servicio» leído de un pantallazo («Es otro servicio»)', () => {
  it('se lee con el contrato del otro servicio y la asistencia queda marcada igual', async () => {
    sembrarVacia()
    const antes = lecturaPantallazo.calls
    const res = await leerCapturaRuta(ruta('leer-captura', { tipo: 'otro', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', porPasos: true, servicios: [] }), params)
    const r = (await res.json()) as { ok: boolean; lectura: LecturaCasilla }
    expect(r.ok).toBe(true)
    expect(lecturaPantallazo.calls).toBe(antes + 1)
    expect(r.lectura.origen).toBeUndefined()
    expect(r.lectura.asistenciaMedica).toBe(true)
  })
})

describe('«Otro servicio» en todo lector', () => {
  it('suma en cada tarifa, sale en el PDF y en «Incluye» de ONE, y es «asistencia» en los servicios del viaje', async () => {
    sembrarVacia()
    await caso11()
    await recalcularTotales(COT_SAN_ANDRES)
    const sin = precioDeTarifas(await opcionesDeAprobacion(COT_SAN_ANDRES))
    const totalSin = Number(tabla('cotizaciones')[0].valor_total)
    const costoSin = Number(tabla('cotizaciones')[0].costo_total)

    const asistencia = await otroAceptado('cap-asistencia', ASISTENCIA)
    const seguro = await otroAceptado('cap-seguro', SEGURO)
    await recalcularTotales(COT_SAN_ANDRES)
    const con = precioDeTarifas(await opcionesDeAprobacion(COT_SAN_ANDRES))
    // El costo sube exactamente lo escrito: 8 × 45.000 + 120.000.
    expect(Number(tabla('cotizaciones')[0].costo_total) - costoSin).toBe(480_000)
    expect(Number(tabla('cotizaciones')[0].valor_total)).toBeGreaterThan(totalSin)
    // Va en las tres tarifas (no compite con nadie): cada una sube.
    expect(Object.keys(con).sort()).toEqual(Object.keys(sin).sort())
    for (const n of Object.keys(sin)) expect(con[n], n).toBeGreaterThan(sin[n])

    // «Incluye» armado por ONE (C6): lo que es y su proveedor.
    ;(tabla('cotizaciones')[0] as Fila).documento_cliente = {
      titular: 'San Andrés y Providencia', intro: 'Cinco noches.', incluye: [], antes_de_viajar: [],
      origen: 'ia', modelo: 'x', redactado_en: '2026-10-12T14:00:00.000Z', fuente_hash: null,
      revisado_por: 's-asesora', revisado_por_nombre: 'Asesora', revisado_en: '2026-10-12T14:10:00.000Z', incluye_origen: 'one',
    }
    captura.activa = true
    captura.props = null
    const pdf = await generateCotizacionPDF(COT_SAN_ANDRES) as { success: boolean; error?: string }
    captura.activa = false
    expect(pdf.success, pdf.error).toBe(true)
    const props = captura.props as { viaje?: { incluye?: string[] } }
    expect(props.viaje?.incluye).toEqual(expect.arrayContaining(['Asistencia médica (Assist Card, plan Básico)', 'Seguro de viaje']))
    // El PDF imprime las dos líneas con su nombre (en «Inversión»).
    const texto = JSON.stringify(captura.props)
    expect(texto).toContain('ASISTENCIA MÉDICA')
    expect(texto).toContain('SEGURO DE VIAJE')

    // Servicios del viaje al aprobar (F0): la asistencia es «asistencia», el seguro «otro».
    const tipoRanura = Object.fromEntries(tabla('items').map(i => [i.id, tabla('cotizacion_ranuras').find(r => r.id === i.ranura_id)?.tipo as string | undefined]))
    const filas = filasDeServicioDeTarifa({ items: tabla('items') as never, seleccion: null, params: { margenPorcentaje: 0 } as never, tipoRanuraPorItem: tipoRanura })
    expect(filas.find(f => f.item_id === asistencia)).toMatchObject({ tipo: 'asistencia', proveedor_nombre: 'Assist Card, plan Básico' })
    expect(filas.find(f => f.item_id === seguro)).toMatchObject({ tipo: 'otro' })
    // «Documentos del viajero»: aparece sola la asistencia, no el seguro.
    const docs = asistenciasDelViaje(filas.map((f, i) => ({ ...f, id: `s-${i}`, estado: 'pendiente', valor_por_pagar: null, voucher_ref: null, gastos: [] })))
    expect(docs.map(d => d.texto)).toEqual(['Asistencia médica · Assist Card, plan Básico'])
  }, 60_000)

  it('ida y vuelta: lo armado encendido se abre, suma, imprime y se aprueba igual con el interruptor apagado', async () => {
    sembrarVacia()
    await caso11()
    await otroAceptado('cap-asistencia', ASISTENCIA)
    await otroAceptado('cap-seguro', SEGURO)
    const despues = structuredClone(base.tablas)
    const premium = tabla('cotizacion_itinerarios').find(t => t.nombre === 'Premium')?.id as string
    const args = { cotizacionId: COT_SAN_ANDRES, negocioId: NEG_SAN_ANDRES, tarifaAprobada: premium }
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-13T15:00:00.000Z') })
    try {
      base.tablas = structuredClone(despues)
      ponerInterruptor(true)
      const encendido = await leerPlata(LECTORES, captura, args)
      base.tablas = structuredClone(despues)
      ponerInterruptor(false)
      const apagado = await leerPlata(LECTORES, captura, args)
      expect(apagado).toEqual(encendido)
      expect((encendido.aprobacion as { resultado: { success: boolean } }).resultado.success).toBe(true)
      expect(JSON.stringify(encendido.pdf)).toContain('ASISTENCIA MÉDICA')
    } finally {
      vi.useRealTimers()
    }
  }, 60_000)
})

describe('N5 · con el interruptor apagado, «Otro servicio» no entra', () => {
  it('escribirlo a mano: sin la marca de la forma por pasos es 400; apagado, POR_PASOS', async () => {
    sembrarVacia()
    expect((await escribirAMano(ASISTENCIA, false)).status).toBe(400)
    sembrarVacia({ interruptor: false })
    tomarRegistro()
    expect((await escribirAMano(ASISTENCIA)).cuerpo).toMatchObject({ ok: false, codigo: 'POR_PASOS' })
    expect(escrituras(tomarRegistro())).toEqual([])
  })

  it('leerlo de un pantallazo: apagado no llama al modelo ni escribe', async () => {
    sembrarVacia({ interruptor: false })
    const antes = lecturaPantallazo.calls
    tomarRegistro()
    const res = await leerCapturaRuta(ruta('leer-captura', { tipo: 'otro', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }), params)
    expect(await res.json()).toMatchObject({ ok: false, codigo: 'POR_PASOS' })
    expect(lecturaPantallazo.calls).toBe(antes)
    expect(escrituras(tomarRegistro())).toEqual([])
  })

  it('aceptarlo (aunque venga firmado, por la ruta de siempre o en lote) y abrir su ranura: rechazado sin escribir', async () => {
    sembrarVacia()
    const { cuerpo } = await escribirAMano(ASISTENCIA)
    const p: Pantallazo = { id: 'cap-asistencia', tipo: 'otro', lectura: cuerpo.lectura!, pistas: SIN_PISTAS }
    sembrarVacia({ interruptor: false })
    tomarRegistro()
    const uno = await aceptarUno(ruta('aceptar-captura', borrador(p)), params)
    expect(await uno.json()).toMatchObject({ ok: false, codigo: 'POR_PASOS' })
    const lote = await postLote([{ id: p.id, borrador: borrador(p, 'nueva') }])
    expect(lote.ok).toBe(false)
    const ranura = await crearRanuraConOpcion(COT_SAN_ANDRES, 'otro', { servicio: 'Asistencia médica' })
    expect(ranura.success).toBe(false)
    expect(escrituras(tomarRegistro())).toEqual([])
    expect(tabla('items')).toEqual([])
    expect(tabla('cotizacion_ranuras')).toEqual([])
  })
})
