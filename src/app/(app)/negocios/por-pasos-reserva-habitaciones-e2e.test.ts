/**
 * HOTEL DE VARIAS HABITACIONES EN UN SOLO PANTALLAZO, de la bandeja al PDF, contra el doble de
 * igualdad de C0 (decisión de Mauricio, 2026-10-14: «mostramos el precio total y dejamos el
 * registro de varias habitaciones»).
 *
 * El lector (Gemini) se reemplaza por las lecturas REALES grabadas el 2026-10-14
 * (`src/lib/cotizaciones/__fixtures__/reserva-varias-habitaciones.json`): la de siempre cuando la
 * lectura no pide la reserva, y la de la reserva cuando la pide. Así se prueba lo que decide ONE:
 * quién pide la reserva (solo la bandeja de la forma por pasos con el interruptor encendido) y qué
 * pasa con la lectura de ahí en adelante.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, tomarRegistro, escrituras } from '../../../../test/igualdad-servidor-doble'
import { COT_SAN_ANDRES } from '../../../../test/caso-san-andres'
import { tablasPorPasos, type OpcionesPorPasos } from '../../../../test/caso-por-pasos'
import type { Pantallazo } from '../../../../test/caso-once-pantallazos'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/actions/get-workspace', async () => {
  const { memoDeRuta } = await import('@/lib/actions/memo-de-ruta')
  const { WS_TRAPPVEL } = await import('../../../../test/caso-san-andres')
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
// El lector: la lectura real de siempre (RX1 en 2 de 3 corridas; aquí la segunda) o la de la
// reserva, según lo que pida ONE.
const lector = vi.hoisted(() => ({ llamadas: [] as unknown[][], reserva: null as unknown }))
vi.mock('@/lib/ai/extraer-ranura', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/ai/extraer-ranura')>()
  const fixture = (await import('@/lib/cotizaciones/__fixtures__/reserva-varias-habitaciones.json')).default
  return {
    ...real,
    extraerRanuraDesdeImagen: async (...args: unknown[]) => {
      lector.llamadas.push(args)
      const opciones = args[5] as { reservaVariasHabitaciones?: boolean } | undefined
      const leida = opciones?.reservaVariasHabitaciones ? (lector.reserva ?? fixture.posadaReserva) : fixture.posadaSiempre[1]
      return { data: structuredClone(leida) }
    },
  }
})
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))

import fixture from '@/lib/cotizaciones/__fixtures__/reserva-varias-habitaciones.json'
import { recalcularTotales } from './cotizacion-actions'
import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { confirmarTarifaPorPasajero } from './tarifa-pax-actions'
import { firmarBorrador } from '@/lib/cotizaciones/firma-borrador'
import { decisionParaAceptar, destinoDeReglas } from '@/lib/cotizaciones/destino-por-pasos'
import { leerTarifaPax, type LecturaCasilla } from '@/lib/cotizaciones/tarifa-pasajero'
import { avisoDeReservaQueNoCuadra, filasDeCosto, resumenDeAlojamiento } from '@/lib/cotizaciones/tarjeta-opcion'
import { lineasDesactualizadas } from '@/lib/cotizaciones/captura-desactualizada'
import { habitacionesDeTarifa, repartirHabitaciones } from '@/lib/cotizaciones/habitaciones'
import { listaUnica } from '@/lib/cotizaciones/lista-unica'
import { POST as aceptarLote } from '@/app/api/cotizaciones/[id]/aceptar-lote/route'
import { POST as leerCapturaRuta } from '@/app/api/cotizaciones/[id]/leer-captura/route'

const tabla = (t: string) => base.tablas[t] ?? []
const VIAJE = { adultos: 6, ninos: 1, infantes: 1 }
const SIN_PISTAS = { lugar: 'Providencia', origen: null, destino: null }
const PNG = 'data:image/png;base64,iVBORw0KGgo='
const ruta = (accion: string, cuerpo: unknown) => new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/${accion}`, { method: 'POST', body: JSON.stringify(cuerpo) })
const params = { params: Promise.resolve({ id: COT_SAN_ANDRES }) }

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
  lector.llamadas = []
  lector.reserva = null
}

type Lectura = { ok: boolean; codigo?: string; mensaje?: string; opciones?: { nombre: string }[]; lectura?: LecturaCasilla; lecturaJson?: string }

/** Lo que manda la bandeja: la forma por pasos con `porPasos` y los servicios del viaje. */
async function leer(porPasos: boolean): Promise<Lectura> {
  const cuerpo = porPasos ? { tipo: 'hotel', dataUrl: PNG, porPasos: true, servicios: [] } : { tipo: 'hotel', dataUrl: PNG }
  return (await (await leerCapturaRuta(ruta('leer-captura', cuerpo), params)).json()) as Lectura
}

async function aceptar(lectura: LecturaCasilla): Promise<string> {
  const p: Pantallazo = { id: 'cap-posada', tipo: 'hotel', lectura, pistas: SIN_PISTAS }
  const { decision, destinoId } = decisionParaAceptar(destinoDeReglas({ tipo: 'hotel', lectura, pistas: SIN_PISTAS, lineas: [], grupoViaje: VIAJE }))
  const lecturaJson = JSON.stringify(lectura)
  const borrador = {
    tipo: 'hotel', lecturaJson, firma: firmarBorrador(COT_SAN_ANDRES, 'hotel', lecturaJson)!,
    pistas: p.pistas, decision, destinoId, imagen: null, correcciones: null, idAceptacion: p.id,
  }
  const res = await aceptarLote(ruta('aceptar-lote', { filas: [{ id: p.id, borrador }] }), params)
  const r = (await res.json()) as { ok: boolean; mensaje?: string; resultados?: { resultado: { ok: boolean; itemId?: string; mensaje?: string } }[] }
  expect(r.ok, r.mensaje).toBe(true)
  expect(r.resultados![0].resultado.ok, r.resultados![0].resultado.mensaje).toBe(true)
  return r.resultados![0].resultado.itemId!
}

describe('la bandeja: quién pide leer la reserva', () => {
  it('la pantalla de siempre no la pide: la Posada queda en «¿Cuál de estas?»', async () => {
    sembrarVacia()
    tomarRegistro()
    const r = await leer(false)
    expect(lector.llamadas).toHaveLength(1)
    expect(lector.llamadas[0]).toHaveLength(5)
    expect(r).toMatchObject({ ok: false, codigo: 'RX1' })
    expect(r.mensaje).toMatch(/^¿Cuál de estas\?/)
    expect(r.opciones!.map(o => o.nombre)).toEqual(['Doble 1', 'Doble 2', 'Doble 3'])
    expect(escrituras(tomarRegistro())).toEqual([])
  })

  it('con el interruptor apagado, aunque la pestaña vieja mande «porPasos», tampoco', async () => {
    sembrarVacia({ interruptor: false })
    const r = await leer(true)
    expect(lector.llamadas[0]).toHaveLength(5)
    expect(r).toMatchObject({ ok: false, codigo: 'RX1' })
  })

  it('la bandeja por pasos la pide y la Posada es UNA opción con el registro de sus 3 dobles', async () => {
    sembrarVacia()
    tomarRegistro()
    const r = await leer(true)
    expect(lector.llamadas[0][5]).toEqual({ reservaVariasHabitaciones: true })
    expect(r.ok, r.mensaje).toBe(true)
    expect(r.lectura!.total).toBe(1_229_098)
    expect(r.lectura!.habitacionesReserva).toHaveLength(3)
    expect(r.lectura!.identidad.tipo_habitacion).toBe('3 habitaciones dobles')
    // Leer no escribe nada: la opción nace al aceptar.
    expect(escrituras(tomarRegistro())).toEqual([])
  })
})

describe('aceptada: el total en la tarjeta, en «Lo que suma» y en el PDF; el registro, a la vista', () => {
  it('una opción de hotel con el costo del total, 3 habitaciones en la tarjeta y el detalle en el PDF', async () => {
    sembrarVacia()
    const r = await leer(true)
    const itemId = await aceptar(r.lectura!)
    expect(tabla('items')).toHaveLength(1)
    // Como todo hotel leído de un pantallazo, el costo lo confirma una persona.
    const confirmado = await confirmarTarifaPorPasajero(itemId, null)
    expect(confirmado.success, confirmado.error).toBe(true)
    await recalcularTotales(COT_SAN_ANDRES)
    const linea = tabla('items').find(i => i.id === itemId)!
    // El costo es el total del pantallazo: sin partirlo por habitación.
    const costo = tabla('rubros').filter(x => x.item_id === itemId).reduce((a, x) => a + Number(x.cantidad) * Number(x.valor_unitario), 0)
    expect(costo).toBe(1_229_098)
    expect(Number(tabla('cotizaciones')[0].costo_total)).toBe(1_229_098)

    // La tarjeta: «3 habitaciones · cubre a los 8 viajeros», no «1 habitación».
    const tarifa = leerTarifaPax(linea.tarifa_pax)
    const resumen = resumenDeAlojamiento(repartirHabitaciones(habitacionesDeTarifa(tarifa), VIAJE, tarifa.correcciones))
    expect(resumen.habitaciones).toBe(3)
    expect(resumen.titulo).toBe('3 habitaciones · cubre a los 8 viajeros')
    expect(resumen.falta).toBeNull()
    expect(avisoDeReservaQueNoCuadra('Posada', tarifa, VIAJE)).toBeNull()
    // «Costo y precio» de la tarjeta: UNA fila con el total, nombrada con el registro.
    const filas = filasDeCosto({ confirmada: tarifa.confirmada ?? null, precioLinea: Number(linea.precio_venta) })
    expect(filas.map(f => ({ nombre: f.nombre, det: f.det, cantidad: f.cantidad, costo: f.costoUnitario, precio: f.precioTotal }))).toEqual([
      { nombre: '3 habitaciones dobles', det: '6 adultos + 1 niño + 1 infante', cantidad: 1, costo: 1_229_098, precio: Number(linea.precio_venta) },
    ])
    expect(Number(linea.precio_venta)).toBeGreaterThan(1_229_098)
    // Nada la frena: ni capturas de otros pasajeros ni confirmación vieja.
    expect(lineasDesactualizadas(tabla('items') as never, VIAJE)).toEqual([])

    captura.activa = true
    captura.props = null
    const pdf = await generateCotizacionPDF(COT_SAN_ANDRES) as { success: boolean; error?: string }
    captura.activa = false
    expect(pdf.success, pdf.error).toBe(true)
    const props = captura.props as { viaje?: { hoteles?: { hotel: string | null; habitacion: string | null; ocupacion: string | null }[] } }
    const hotel = props.viaje?.hoteles?.[0]
    expect(hotel).toMatchObject({
      hotel: 'Posada Enilda',
      habitacion: '3 habitaciones dobles',
      ocupacion: 'Doble 1: 2 adultos; Doble 2: 2 adultos; Doble 3: 2 adultos + 1 niño + 1 infante',
    })
    // El PDF no imprime precio por habitación.
    const texto = JSON.stringify(captura.props)
    expect(texto).not.toMatch(/409[.]?69[89]|409[.]?700/)
  }, 60_000)

  it('si la reserva no cuadra con los viajeros se avisa en la lista, en ámbar: no impide enviar', async () => {
    sembrarVacia()
    // La misma reserva con dos dobles de solo adultos: cubre 4 de los 8.
    const dos = structuredClone(fixture.posadaReserva) as typeof fixture.posadaReserva
    dos.habitacionesReserva = dos.habitacionesReserva!.slice(0, 2)
    dos.campos.precio_total.value = '819398'
    lector.reserva = dos
    const r = await leer(true)
    expect(r.ok, r.mensaje).toBe(true)
    const itemId = await aceptar(r.lectura!)
    await recalcularTotales(COT_SAN_ANDRES)
    // Se confirma igual: hoy no lo frena nada, y el aviso tampoco lo frena.
    const confirmado = await confirmarTarifaPorPasajero(itemId, null)
    expect(confirmado.success, confirmado.error).toBe(true)
    expect(lineasDesactualizadas(tabla('items') as never, VIAJE)).toEqual([])
    const tarifa = leerTarifaPax(tabla('items').find(i => i.id === itemId)!.tarifa_pax)
    const texto = avisoDeReservaQueNoCuadra('POSADA ENILDA', tarifa, VIAJE)
    expect(texto).toBe('Posada Enilda: las 2 habitaciones del pantallazo dejan por fuera a 2 adultos, 1 niño y 1 infante. Revisa la reserva con el proveedor.')
    const lista = listaUnica({
      sinPrecio: [], capturas: null, tarifas: [], salida: null, pantallazosPorAceptar: 0, texto: 'ok',
      noVan: [], faltaDia: null, margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null,
      reservasQueNoCuadran: [{ itemId, texto: texto! }],
    })
    expect(lista.impide).toEqual([])
    expect(lista.revisar).toEqual([{ clave: `reserva:${itemId}`, texto, ir: { a: 'opcion', itemId } }])
  }, 60_000)
})
