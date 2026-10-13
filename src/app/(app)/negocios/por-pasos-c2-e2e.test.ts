/**
 * C2 · TODA OPCIÓN EN TARIFAS, contra el doble de igualdad de C0 y el caso fijo de San Andrés.
 *
 *  · IDA Y VUELTA (condición de Mauricio): se enciende, se edita con las acciones nuevas, se
 *    apaga, y el total, el precio de cada tarifa, las props del PDF y la aprobación son
 *    exactamente los mismos.
 *  · N5: cada acción nueva, con el interruptor apagado, se rechaza sin escribir nada.
 *  · N8, P1, P5 (decisión L), P8, P9, P12 y P14 sobre el servidor de verdad.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, escrituras, tomarRegistro, type Fila } from '../../../../test/igualdad-servidor-doble'
import { COT_SAN_ANDRES, NEG_SAN_ANDRES, WS_TRAPPVEL } from '../../../../test/caso-san-andres'
import { tablasPorPasos, type OpcionesPorPasos } from '../../../../test/caso-por-pasos'
import { leerPlata, ponerInterruptor } from '../../../../test/por-pasos-lectura'

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
// El marco del negocio es el de siempre y lee medio negocio con métodos que el doble no conoce.
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

import { recalcularTotales } from './cotizacion-actions'
import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { aceptarCotizacionNegocio, opcionesDeAprobacion } from './[id]/cotizacion/actions'
import {
  elegirOpcionEnTarifa,
  eliminarOpcionPorPasos,
  enviarPorPasos,
  juntarServicioPorPasos,
  mandarTarifa,
  moverOpcionPorPasos,
  separarOpcionPorPasos,
} from './por-pasos-actions'
import { escribirPrecioQueFalta } from './tarifa-pax-actions'
import { tarifasTrasAceptar } from '@/lib/cotizaciones/por-pasos-cierre'
import { violacionDeInvariante } from '@/lib/cotizaciones/tarifas-por-pasos'
import { ranurasConAlternativas } from '@/lib/cotizaciones/itinerarios'

const LECTORES = { recalcularTotales, generateCotizacionPDF, opcionesDeAprobacion, aceptarCotizacionNegocio }
const CAYO = 'actividad: Cayo Cangrejo'
const TRASLADO_SA = 'traslado 2: Traslado en San Andrés'
const HOTEL_SA = 'hotel 2: Hotel en San Andrés'

function sembrar(o: OpcionesPorPasos = {}) {
  base.tablas = tablasPorPasos(o)
  base.secuencia = 0
  base.registro = []
}
const tabla = (n: string) => base.tablas[n] as Fila[]
const tarifa = (nombre: string) => tabla('cotizacion_itinerarios').find(t => t.nombre === nombre) as Fila
const seleccion = (id: string) => tabla('itinerario_opciones').filter(o => o.itinerario_id === id).map(o => o.item_id as string)

/** El estado de tarifas tal como quedó en la base, para la invariante de P1. */
function estadoEnLaBase() {
  const items = tabla('items').filter(i => i.cotizacion_id === COT_SAN_ANDRES).map(i => ({
    id: i.id as string, grupo: (i.grupo ?? null) as string | null, orden: Number(i.orden ?? 0), es_ajuste: i.es_ajuste === true,
    dia_relativo: (i.dia_relativo ?? null) as number | null, entra_al_precio: (i.entra_al_precio ?? null) as boolean | null,
  }))
  const tarifas = tabla('cotizacion_itinerarios').filter(t => t.cotizacion_id === COT_SAN_ANDRES).map(t => ({
    id: t.id as string, nombre: (t.nombre ?? null) as string | null, orden: Number(t.orden), vaEnPropuesta: t.va_en_propuesta === true, seleccion: seleccion(t.id as string),
  }))
  return { items, tarifas }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-12T15:00:00.000Z') })
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
})

// ── N5 · con el interruptor apagado, ninguna acción nueva escribe ────────────

describe('N5 · las acciones nuevas de C2 se rechazan con el interruptor apagado', () => {
  const ACCIONES: [string, () => Promise<{ success: boolean; error?: string }>][] = [
    ['elegir opción en una tarifa', () => elegirOpcionEnTarifa('tf-premium', CAYO, 'a-cayo-compartida')],
    ['mandar una tarifa', () => mandarTarifa('tf-economica', true)],
    ['mover una opción', () => moverOpcionPorPasos('h-lord-pierre', 'hotel: Hotel en Providencia')],
    ['separar una opción', () => separarOpcionPorPasos('h-lord-pierre')],
    ['juntar un servicio', () => juntarServicioPorPasos(COT_SAN_ANDRES, 'traslado: Traslado en Providencia', TRASLADO_SA)],
    ['eliminar una opción', () => eliminarOpcionPorPasos('h-lord-pierre')],
    ['enviar al cliente', () => enviarPorPasos(COT_SAN_ANDRES)],
    ['escribir el precio que falta', async () => { const r = await escribirPrecioQueFalta('v-satena', 'nino', 1); return { success: r.success, error: r.error } }],
    ['cerrar tras aceptar', () => tarifasTrasAceptar(COT_SAN_ANDRES, null)],
  ]
  for (const [nombre, accion] of ACCIONES) {
    it(`${nombre}: rechaza y no escribe`, async () => {
      sembrar({ interruptor: false })
      const r = await accion()
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/no está encendida/)
      expect(escrituras(tomarRegistro())).toEqual([])
    })
  }
})

// ── La prueba de IDA Y VUELTA ────────────────────────────────────────────────

describe('Ida y vuelta: lo hecho con el interruptor encendido se lee igual apagado', () => {
  it('encender, editar con las acciones nuevas, apagar: mismo total, mismas tarifas, mismo PDF, misma aprobación', async () => {
    // Una cotización vieja (no nombra Cayo Cangrejo en ninguna tarifa) con el caso del flujo nuevo:
    // dos traslados en San Andrés y el de Providencia Opcional.
    sembrar({ caso: { flujoNuevo: true } })
    base.tablas.itinerario_opciones = tabla('itinerario_opciones').filter(o => !String(o.item_id).startsWith('a-cayo') && !String(o.item_id).startsWith('t-san-andres'))
    await recalcularTotales(COT_SAN_ANDRES)

    // Encendido: la Recomendada toma la lancha privada, la Premium el traslado privado, y la
    // Económica (que quedó distinta) se manda.
    expect((await elegirOpcionEnTarifa('tf-recomendada', CAYO, 'a-cayo-privada')).success).toBe(true)
    expect((await elegirOpcionEnTarifa('tf-premium', TRASLADO_SA, 't-san-andres-privado')).success).toBe(true)
    expect((await elegirOpcionEnTarifa('tf-economica', HOTEL_SA, 'h-lord-pierre')).success).toBe(true)
    expect(tarifa('Económica').va_en_propuesta).toBe(true)
    expect(violacionDeInvariante(estadoEnLaBase())).toBeNull()

    // Lo escrito, congelado: la misma base se lee una vez encendida y otra apagada.
    const despues = structuredClone(base.tablas)
    const args = { cotizacionId: COT_SAN_ANDRES, negocioId: NEG_SAN_ANDRES, tarifaAprobada: 'tf-premium' }

    base.tablas = structuredClone(despues)
    ponerInterruptor(true)
    const encendido = await leerPlata(LECTORES, captura, args)

    base.tablas = structuredClone(despues)
    ponerInterruptor(false)
    const apagado = await leerPlata(LECTORES, captura, args)

    expect(apagado).toEqual(encendido)
    // Y lo que se lee es lo que se escogió: la Recomendada cobra la lancha privada.
    const tarifas = (apagado.tarifas as { tarifas: { nombre: string; precio: number }[] }).tarifas
    const rec = tarifas.find(t => t.nombre === 'Recomendada')!
    expect((apagado.recalculo as { cotizacion: { valor_total: number } }).cotizacion.valor_total).toBe(rec.precio)
    expect((apagado.aprobacion as { resultado: { success: boolean } }).resultado.success).toBe(true)
    expect((apagado.aprobacion as { precio_aprobado: number }).precio_aprobado).toBe(tarifas.find(t => t.nombre === 'Premium')!.precio)
    // P14 · el registro de decisiones del PDF guarda también la actividad y el traslado escogidos.
    const registro = (apagado.pdf as { escrituras: { tabla: string; payload: unknown }[] }).escrituras.filter(e => e.tabla === 'decisiones_combinacion')
    const filas = registro.flatMap(e => (Array.isArray(e.payload) ? e.payload : [e.payload])) as Fila[]
    const deLaPremium = JSON.stringify(filas.find(f => f.itinerario_id === 'tf-premium') ?? null)
    expect(deLaPremium).toContain('t-san-andres-privado')
    expect(JSON.stringify(filas.find(f => f.itinerario_id === 'tf-recomendada') ?? null)).toContain('a-cayo-privada')

    // La pantalla de siempre abre con el interruptor apagado: la página arma el editor sin error.
    base.tablas = structuredClone(despues)
    ponerInterruptor(false)
    const { default: Pagina } = await import('./[id]/cotizacion/[cotId]/page')
    const jsx = await Pagina({ params: Promise.resolve({ id: NEG_SAN_ANDRES, cotId: COT_SAN_ANDRES }) })
    expect(jsx).toBeTruthy()
  }, 60_000)
})

// ── N8 · al escribir se guarda lo que hoy cuenta ────────────────────────────

describe('N8 · la primera escritura guarda lo que hoy cuenta, no la propuesta de ONE', () => {
  it('una tarifa vieja sin Cayo Cangrejo: tras la primera acción, la Premium sigue cobrando lo mismo', async () => {
    sembrar()
    base.tablas.itinerario_opciones = tabla('itinerario_opciones').filter(o => !String(o.item_id).startsWith('a-cayo'))
    await recalcularTotales(COT_SAN_ANDRES)
    const antes = ((await opcionesDeAprobacion(COT_SAN_ANDRES)) as { tarifas: { nombre: string; precio: number }[] }).tarifas
    // Cualquier escritura de la forma nueva: «mandar» la Premium (ya va).
    expect((await mandarTarifa('tf-premium', true)).success).toBe(true)
    expect(seleccion('tf-premium')).toContain('a-cayo-compartida')
    expect(seleccion('tf-premium')).not.toContain('a-cayo-privada')
    const despues = ((await opcionesDeAprobacion(COT_SAN_ANDRES)) as { tarifas: { nombre: string; precio: number }[] }).tarifas
    expect(despues).toEqual(antes)
  })
})

// ── P8 y la Recomendada ──────────────────────────────────────────────────────

describe('P8 · tarifa idéntica, y la Recomendada siempre va', () => {
  it('no se manda una Económica igual a la Recomendada, y lo dice', async () => {
    sembrar()
    const r = await mandarTarifa('tf-economica', true)
    expect(r).toEqual({ success: false, error: 'Quedó igual a la Recomendada: no se manda. Cambia una opción para mandarla.' })
    expect(tarifa('Económica').va_en_propuesta).toBe(false)
  })

  it('la Recomendada no se puede sacar de la propuesta', async () => {
    sembrar()
    const r = await mandarTarifa('tf-recomendada', false)
    expect(r.success).toBe(false)
    expect(tarifa('Recomendada').va_en_propuesta).toBe(true)
  })

  it('cambiar una opción de una tarifa que solo existía en el supuesto la vuelve a completar', async () => {
    sembrar()
    const r = await elegirOpcionEnTarifa('tf-premium', CAYO, 'a-cayo-compartida')
    expect(r.success).toBe(true)
    expect((r as { anterior: string | null }).anterior).toBe('a-cayo-privada')
    expect(seleccion('tf-premium').filter(id => id.startsWith('a-cayo'))).toEqual(['a-cayo-compartida'])
  })

  it('rechaza una opción de otro servicio o un servicio sin opciones', async () => {
    sembrar()
    expect((await elegirOpcionEnTarifa('tf-premium', CAYO, 'h-posada')).success).toBe(false)
    expect((await elegirOpcionEnTarifa('tf-premium', 'traslado: Traslado en Providencia', 't-providencia')).success).toBe(false)
  })
})

// ── P5 y la decisión L ───────────────────────────────────────────────────────

describe('P5 · bajo el mínimo: rojo y no se envía, pero la tarifa no sale sola de la propuesta (decisión L)', () => {
  it('Lord Pierre a precio de promoción escrito a mano deja la Premium bajo el 5 %: sigue en la propuesta', async () => {
    sembrar()
    const lord = tabla('items').find(i => i.id === 'h-lord-pierre') as Fila
    lord.precio_manual = true
    lord.precio_venta = 4_000_000 // promoción muy por debajo del costo (6.420.000): la Premium queda bajo el 5 %
    await recalcularTotales(COT_SAN_ANDRES)
    expect((await elegirOpcionEnTarifa('tf-premium', CAYO, 'a-cayo-compartida')).success).toBe(true)
    expect(tarifa('Premium').va_en_propuesta).toBe(true)
    expect(tarifa('Recomendada').va_en_propuesta).toBe(true)
    // La salida la frena: «Enviar al cliente» se rechaza hasta que el dueño autorice.
    const r = await enviarPorPasos(COT_SAN_ANDRES)
    expect(r.success).toBe(false)
    expect((r as { error: string }).error).toMatch(/Premium/)
  })
})

// ── P9 · solo opciones de traslado o actividad ──────────────────────────────

describe('P9 · las únicas opciones son de Cayo Cangrejo: una sola tarifa y el PDF con «Día a día»', () => {
  it('no se crean Económica ni Premium; la elección queda en la Recomendada y el PDF conserva el día a día', async () => {
    sembrar()
    base.tablas.items = tabla('items').filter(i => i.id !== 'h-agua-dulce' && i.id !== 'h-lord-pierre')
    base.tablas.rubros = tabla('rubros').filter(r => r.item_id !== 'h-agua-dulce' && r.item_id !== 'h-lord-pierre')
    base.tablas.cotizacion_itinerarios = []
    base.tablas.itinerario_opciones = []
    expect((await tarifasTrasAceptar(COT_SAN_ANDRES, null)).success).toBe(true)
    expect(tabla('cotizacion_itinerarios').map(t => [t.nombre, t.va_en_propuesta])).toEqual([['Recomendada', true]])
    const rec = tarifa('Recomendada').id as string
    expect((await elegirOpcionEnTarifa(rec, CAYO, 'a-cayo-privada')).success).toBe(true)

    captura.activa = true
    captura.props = null
    const res = (await generateCotizacionPDF(COT_SAN_ANDRES)) as { success: boolean }
    captura.activa = false
    expect(res.success).toBe(true)
    const props = captura.props as { itinerarios: unknown; dias: { dia: number; items: { nombre: string }[] }[] | null; total?: number }
    expect(props.itinerarios).toBeNull()
    expect(props.dias).not.toBeNull()
    const dia2 = props.dias!.find(d => d.dia === 2)!
    expect(JSON.stringify(dia2.items)).toMatch(/PRIVADA|privada/)
    expect(JSON.stringify(dia2.items)).not.toMatch(/COMPARTIDA|compartida/)
  }, 30_000)
})

// ── P1 sobre el servidor: acciones reales al azar ───────────────────────────

describe('P1 · ninguna secuencia de acciones reales deja una tarifa incompleta ni a la Recomendada fuera', () => {
  for (const semilla of [3, 11]) {
    it(`semilla ${semilla}: 25 acciones de la forma nueva sobre el caso fijo`, async () => {
      sembrar({ caso: { flujoNuevo: true } })
      let s = semilla
      const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
      const elige = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
      await tarifasTrasAceptar(COT_SAN_ANDRES, null)
      for (let paso = 0; paso < 25; paso++) {
        const { items, tarifas } = estadoEnLaBase()
        const ranuras = ranurasConAlternativas(items)
        const accion = elige(['elegir', 'mandar', 'mover', 'separar', 'juntar', 'eliminar'] as const)
        const t = elige(tarifas)
        if (accion === 'elegir' && ranuras.length > 0 && t) {
          const ra = elige(ranuras)
          await elegirOpcionEnTarifa(t.id, ra.grupo, elige(ra.candidatos))
        } else if (accion === 'mandar' && t) {
          await mandarTarifa(t.id, r() < 0.5)
        } else if (accion === 'mover') {
          const i = elige(items)
          const tipo = String(i.grupo).split(/[\s:]/)[0]
          const otros = [...new Set(items.map(x => x.grupo as string))].filter(g => g.startsWith(tipo) && g !== i.grupo)
          if (otros.length > 0) await moverOpcionPorPasos(i.id, elige(otros))
        } else if (accion === 'separar') {
          await separarOpcionPorPasos(elige(items).id)
        } else if (accion === 'juntar') {
          const i = elige(items)
          const tipo = String(i.grupo).split(/[\s:]/)[0]
          const otros = [...new Set(items.map(x => x.grupo as string))].filter(g => g.startsWith(tipo) && g !== i.grupo)
          if (otros.length > 0) await juntarServicioPorPasos(COT_SAN_ANDRES, i.grupo as string, elige(otros))
        } else if (accion === 'eliminar' && items.length > 6) {
          await eliminarOpcionPorPasos(elige(items).id)
        }
        expect(violacionDeInvariante(estadoEnLaBase()), `paso ${paso}: ${accion}`).toBeNull()
      }
    }, 120_000)
  }
})

// ── P12 · el precio por pasajero que falta ──────────────────────────────────

describe('P12 · una opción sin el precio del niño o del infante no se envía', () => {
  /** SATENA como la deja un pantallazo con solo el precio de los adultos. */
  function satenaSoloAdultos() {
    const v = tabla('items').find(i => i.id === 'v-satena') as Fila
    const tp = structuredClone(v.tarifa_pax) as Fila
    const casillas = tp.casillas as { grupo_completo: Fila }
    casillas.grupo_completo = {
      ...casillas.grupo_completo,
      total: 2_682_000, aPagarAgencia: null,
      porTipo: [{ tipo: 'adulto', cantidad: 6, subtotal: 2_682_000 }],
      ocupacion: { adultos: 6, ninos: 1, infantes: 1, total: null }, ocupacionDelItem: false,
      identidad: {}, notasCliente: [], alertas: [], descripcion: '', paraComposicion: { adultos: 6, ninos: 1, infantes: 1 },
    }
    delete tp.confirmada
    // La línea dice a quiénes cubre (el doble no trae el negocio por el embed de la cotización).
    tp.composicion = { adultos: 6, ninos: 1, infantes: 1 }
    v.tarifa_pax = tp
    v.subtotal = 0
    base.tablas.rubros = tabla('rubros').filter(r => r.item_id !== 'v-satena')
  }

  it('enviar se rechaza nombrando la opción y lo que falta; con el precio a mano y «No paga», se cierra', async () => {
    sembrar()
    satenaSoloAdultos()
    await recalcularTotales(COT_SAN_ANDRES)
    const r1 = await enviarPorPasos(COT_SAN_ANDRES)
    expect(r1.success).toBe(false)
    expect((r1 as { error: string }).error).toMatch(/SATENA/)
    expect((r1 as { error: string }).error).toMatch(/niño e infante/)

    const nino = await escribirPrecioQueFalta('v-satena', 'nino', 447_000)
    expect(nino.success, nino.error).toBe(true)
    const infante = await escribirPrecioQueFalta('v-satena', 'infante', 0)
    expect(infante.success, infante.error).toBe(true)
    // Quedó registrado quién lo escribió, y el costo quedó confirmado.
    const v = tabla('items').find(i => i.id === 'v-satena') as Fila
    const tp = v.tarifa_pax as { costosAMano: Record<string, { unitario: number; porId: string }>; confirmada: { costos: { tipo: string; unitarioCOP: number }[] } }
    expect(tp.costosAMano.infante).toMatchObject({ unitario: 0, porId: 'p-asesora' })
    expect(tp.confirmada.costos.map(c => [c.tipo, c.unitarioCOP])).toEqual([['adulto', 447_000], ['nino', 447_000], ['infante', 0]])
    const r2 = await enviarPorPasos(COT_SAN_ANDRES)
    expect((r2 as { error?: string }).error ?? '').not.toMatch(/precio por pasajero/)
  }, 30_000)

  it('no deja tapar a mano un precio que el pantallazo sí trae', async () => {
    sembrar()
    const r = await escribirPrecioQueFalta('v-avianca', 'nino', 1)
    expect(r.success).toBe(false)
  })
})

// ── La bandeja de la forma nueva: aceptar con `porPasos` ─────────────────────

describe('C2 · aceptar desde la bandeja con la forma nueva deja las tarifas completas', () => {
  /** Un hotel escrito a mano en Providencia, más caro que Cabañas Agua Dulce, como otra opción. */
  async function aceptarHotel(porPasos: boolean) {
    const { lecturaManual } = await import('@/lib/cotizaciones/ingreso-manual')
    const { ranuraPorSlug } = await import('@/lib/cotizaciones/ranuras-pantallazo')
    const { firmarBorrador } = await import('@/lib/cotizaciones/firma-borrador')
    const ruta = await import('@/app/api/cotizaciones/[id]/aceptar-captura/route')
    const r = lecturaManual({
      ranura: ranuraPorSlug('hotel_detalle')!,
      entrada: {
        tipo: 'hotel',
        datos: {
          hotel: 'Deep Blue', ciudad: 'Providencia', entrada: '2026-11-23', salida: '2026-11-25', habitacion: 'Suite vista al mar',
          regimen: 'Alojamiento y desayuno', incluye: '', adultos: 6, ninos: 1, infantes: 1,
          netoAdulto: 650_000, netoNino: 650_000, netoInfante: 0, edadDesde: null, edadHasta: null, fuente: 'Portafolio de prueba',
        },
      },
      leidaEn: '2026-10-12T14:30:00.000Z',
      hoy: '2026-10-12',
    })
    if (!r.ok) throw new Error(JSON.stringify(r.errores))
    const lecturaJson = JSON.stringify(r.lectura)
    const cuerpo = {
      tipo: 'hotel', lecturaJson, firma: firmarBorrador(COT_SAN_ANDRES, 'hotel', lecturaJson)!,
      pistas: { lugar: 'Providencia', origen: null, destino: null }, decision: 'opcion', destinoId: null,
      imagen: null, correcciones: null, idAceptacion: null, porPasos,
    }
    const res = await ruta.POST(
      new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/aceptar-captura`, { method: 'POST', body: JSON.stringify(cuerpo) }),
      { params: Promise.resolve({ id: COT_SAN_ANDRES }) },
    )
    return (await res.json()) as { ok: boolean; codigo?: string; mensaje?: string; itemId?: string }
  }

  it('la opción nueva del hotel entra en las tres tarifas con la propuesta de ONE', async () => {
    sembrar()
    await recalcularTotales(COT_SAN_ANDRES)
    const r = await aceptarHotel(true)
    expect(r.ok, r.mensaje).toBe(true)
    expect(violacionDeInvariante(estadoEnLaBase())).toBeNull()
    const nueva = r.itemId!
    expect(tabla('items').find(i => i.id === nueva)?.grupo).toBe('hotel: Hotel en Providencia')
    // La más cara pasa a la Premium (que seguía con la propuesta); la Recomendada sigue con la
    // primera pegada y la Económica con la más barata.
    expect(seleccion('tf-premium')).toContain(nueva)
    expect(seleccion('tf-recomendada')).toContain('h-posada')
    expect(seleccion('tf-economica')).toContain('h-posada')
    expect(tarifa('Recomendada').va_en_propuesta).toBe(true)
  }, 30_000)

  it('con el interruptor apagado y la marca de la forma nueva, no acepta nada y pide recargar', async () => {
    sembrar({ interruptor: false })
    tomarRegistro()
    const r = await aceptarHotel(true)
    expect(r.ok).toBe(false)
    expect(r.codigo).toBe('POR_PASOS')
    expect(escrituras(tomarRegistro())).toEqual([])
  }, 30_000)
})
