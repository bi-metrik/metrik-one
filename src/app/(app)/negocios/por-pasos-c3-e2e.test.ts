/**
 * C3 · «Incluido · Opcional · No va» del servicio, y el TRASLADO OPCIONAL (criterio P10).
 *
 *  · Traslado Opcional: escribe `entra_al_precio = false` y `mostrar_en_sugeridos = true`, no
 *    suma, y sale en «Opcionales» del PDF con su precio (render de verdad, texto del PDF).
 *  · Vuelo y hotel siguen sin Opcional: el servidor lo rechaza.
 *  · Hotel «No va»: sale del precio, de las tarifas y del documento.
 *  · Ida y vuelta: lo escrito encendido se lee igual apagado.
 *  · N5: con el interruptor apagado (o la pieza `opcional_traslado` apagada), se rechaza.
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
import { estadoDeServicioPorPasos } from './por-pasos-actions'
import { textoDelPDF } from '@/lib/pdf/texto-del-pdf'
import { violacionDeInvariante } from '@/lib/cotizaciones/tarifas-por-pasos'

const LECTORES = { recalcularTotales, generateCotizacionPDF, opcionesDeAprobacion, aceptarCotizacionNegocio }
const TRASLADO_PROV = 'traslado: Traslado en Providencia'
const HOTEL_SA = 'hotel 2: Hotel en San Andrés'

function sembrar(o: OpcionesPorPasos = {}) {
  base.tablas = tablasPorPasos(o)
  base.secuencia = 0
  base.registro = []
}
const item = (id: string) => (base.tablas.items as Fila[]).find(i => i.id === id) as Fila
const valorTotal = () => Number((base.tablas.cotizaciones[0] as Fila).valor_total)
const seleccion = (id: string) => (base.tablas.itinerario_opciones as Fila[]).filter(o => o.itinerario_id === id).map(o => o.item_id as string)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-12T15:00:00.000Z') })
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
})

async function pdf() {
  captura.activa = true
  captura.props = null
  const r = (await generateCotizacionPDF(COT_SAN_ANDRES)) as { success: boolean; pdf: string }
  captura.activa = false
  expect(r.success).toBe(true)
  return { props: captura.props as Fila, texto: textoDelPDF(Buffer.from(r.pdf, 'base64')) }
}

describe('P10 · traslado Opcional', () => {
  it('escribe las dos columnas de la actividad, no suma y sale en «Opcionales» del PDF con su precio', async () => {
    sembrar()
    await recalcularTotales(COT_SAN_ANDRES)
    const totalAntes = valorTotal()
    const precioTraslado = Number(item('t-providencia').precio_venta)
    expect(precioTraslado).toBeGreaterThan(0)
    const nombresAntes = ((await pdf()).props.itinerarios as { items: { nombre: string }[] }[]).map(b => b.items.map(i => i.nombre))

    const r = await estadoDeServicioPorPasos(COT_SAN_ANDRES, TRASLADO_PROV, 'opcional')
    expect(r.success, (r as { error?: string }).error).toBe(true)
    expect((r as { anterior: Record<string, string> }).anterior).toEqual({ 't-providencia': 'incluido' })
    expect(item('t-providencia')).toMatchObject({ entra_al_precio: false, mostrar_en_sugeridos: true })
    // No suma: el total baja exactamente lo que el traslado aportaba.
    expect(valorTotal()).toBe(totalAntes - precioTraslado)

    const { props, texto } = await pdf()
    const sugeridos = (props.sugeridos ?? []) as { nombre: string; precio_venta: number }[]
    expect(sugeridos).toHaveLength(1)
    expect(sugeridos[0].precio_venta).toBe(precioTraslado)
    // Ninguna tarifa lo imprime como incluido: cada bloque perdió exactamente esa línea.
    const bloques = (props.itinerarios ?? []) as { items: { nombre: string }[] }[]
    const nombreTraslado = sugeridos[0].nombre
    bloques.forEach((b, i) => {
      expect(b.items.map(x => x.nombre)).not.toContain(nombreTraslado)
      expect(nombresAntes[i].filter(n => n !== nombreTraslado)).toEqual(b.items.map(x => x.nombre))
    })
    // El documento de verdad lo dice, con su precio.
    expect(texto).toMatch(/OPCIONALES|Opcionales/)
    const miles = precioTraslado.toLocaleString('es-CO')
    expect(texto).toContain(miles)
  }, 60_000)

  it('vuelo y hotel siguen sin Opcional: el servidor lo rechaza y no escribe', async () => {
    sembrar()
    tomarRegistro()
    for (const grupo of ['vuelo: Vuelo Bogotá ⇄ San Andrés', HOTEL_SA]) {
      const r = await estadoDeServicioPorPasos(COT_SAN_ANDRES, grupo, 'opcional')
      expect(r.success).toBe(false)
      expect((r as { error: string }).error).toMatch(/va o no va: no puede ser opcional/)
    }
    expect(escrituras(tomarRegistro())).toEqual([])
  })

  it('volver a «Incluido» deja el total como estaba (el «Deshacer»)', async () => {
    sembrar()
    await recalcularTotales(COT_SAN_ANDRES)
    const total = valorTotal()
    await estadoDeServicioPorPasos(COT_SAN_ANDRES, TRASLADO_PROV, 'opcional')
    await estadoDeServicioPorPasos(COT_SAN_ANDRES, TRASLADO_PROV, 'incluido')
    expect(valorTotal()).toBe(total)
    expect(item('t-providencia')).toMatchObject({ entra_al_precio: true, mostrar_en_sugeridos: true })
  })
})

describe('C3 · hotel y servicio «No va»', () => {
  it('el hotel de San Andrés no va: sale de las tarifas, del total y del documento', async () => {
    sembrar()
    await recalcularTotales(COT_SAN_ANDRES)
    const total = valorTotal()
    const r = await estadoDeServicioPorPasos(COT_SAN_ANDRES, HOTEL_SA, 'no')
    expect(r.success, (r as { error?: string }).error).toBe(true)
    for (const id of ['h-verde-mar', 'h-lord-pierre']) expect(item(id)).toMatchObject({ entra_al_precio: false, mostrar_en_sugeridos: false })
    expect(valorTotal()).toBeLessThan(total - 5_000_000)
    // Ninguna tarifa queda nombrándolo como algo que suma, y siguen completas.
    const items = (base.tablas.items as Fila[]).map(i => ({ id: i.id as string, grupo: i.grupo as string, orden: Number(i.orden), es_ajuste: false, dia_relativo: (i.dia_relativo ?? null) as number | null, entra_al_precio: (i.entra_al_precio ?? null) as boolean | null }))
    const tarifas = (base.tablas.cotizacion_itinerarios as Fila[]).map(t => ({ id: t.id as string, nombre: t.nombre as string, orden: Number(t.orden), vaEnPropuesta: t.va_en_propuesta === true, seleccion: seleccion(t.id as string) }))
    expect(violacionDeInvariante({ items, tarifas })).toBeNull()
    const { props, texto } = await pdf()
    expect(JSON.stringify(props.sugeridos ?? null)).not.toMatch(/VERDE MAR|LORD PIERRE|Verde Mar|Lord Pierre/)
    expect(texto).not.toMatch(/Verde Mar|VERDE MAR|Lord Pierre|LORD PIERRE/)
    // Y vuelve igual.
    await estadoDeServicioPorPasos(COT_SAN_ANDRES, HOTEL_SA, 'incluido')
    expect(valorTotal()).toBe(total)
  }, 60_000)

  it('la actividad que no va recuerda que era Opcional y vuelve así', async () => {
    sembrar()
    await estadoDeServicioPorPasos(COT_SAN_ANDRES, 'actividad 2: Buceo de bautismo', 'opcional')
    await estadoDeServicioPorPasos(COT_SAN_ANDRES, 'actividad 2: Buceo de bautismo', 'no')
    expect((item('a-buceo').tarifa_pax as { noVa?: { era: string; porId: string } }).noVa).toMatchObject({ era: 'opcional', porId: 'p-asesora' })
    // El día se conserva en los tres estados.
    expect(item('a-buceo').dia_relativo).toBe(4)
  })
})

describe('C3 · ida y vuelta y el interruptor', () => {
  it('traslado Opcional y hotel que no va, hechos encendido, se leen igual apagado', async () => {
    sembrar()
    await recalcularTotales(COT_SAN_ANDRES)
    await estadoDeServicioPorPasos(COT_SAN_ANDRES, TRASLADO_PROV, 'opcional')
    await estadoDeServicioPorPasos(COT_SAN_ANDRES, 'actividad 2: Buceo de bautismo', 'no')
    const despues = structuredClone(base.tablas)
    const args = { cotizacionId: COT_SAN_ANDRES, negocioId: NEG_SAN_ANDRES, tarifaAprobada: 'tf-premium' }
    base.tablas = structuredClone(despues)
    ponerInterruptor(true)
    const encendido = await leerPlata(LECTORES, captura, args)
    base.tablas = structuredClone(despues)
    ponerInterruptor(false)
    const apagado = await leerPlata(LECTORES, captura, args)
    expect(apagado).toEqual(encendido)
  }, 60_000)

  it('con el interruptor apagado se rechaza sin escribir', async () => {
    sembrar({ interruptor: false })
    tomarRegistro()
    const r = await estadoDeServicioPorPasos(COT_SAN_ANDRES, TRASLADO_PROV, 'opcional')
    expect(r.success).toBe(false)
    expect(escrituras(tomarRegistro())).toEqual([])
  })

  it('con la pieza `opcional_traslado` apagada, el traslado no pasa a Opcional (pero «No va» sí)', async () => {
    sembrar({ piezasApagadas: ['opcional_traslado'] })
    const r = await estadoDeServicioPorPasos(COT_SAN_ANDRES, TRASLADO_PROV, 'opcional')
    expect(r.success).toBe(false)
    expect((r as { error: string }).error).toMatch(/apagada/)
    expect((await estadoDeServicioPorPasos(COT_SAN_ANDRES, TRASLADO_PROV, 'no')).success).toBe(true)
  })
})
