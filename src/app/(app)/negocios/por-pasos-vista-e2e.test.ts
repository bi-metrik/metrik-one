/**
 * C4 · P3 de Vera: LA PANTALLA CALCULA IGUAL QUE EL SERVIDOR.
 *
 * Lo que el navegador calcula para cada tarifa (`por-pasos-vista.ts`, sobre las líneas que la
 * página ya tiene) coincide al peso con lo que el servidor guarda después: `valor_total` de
 * `recalcularTotales` y el precio de cada tarifa de `opcionesDeAprobacion`. Mismo fixture, en el
 * caso fijo, en el del flujo nuevo, en V1 (sin SATENA) y en V2 (buceo opcional), y con un
 * adicional que el editor de siempre no sumaba en pantalla.
 *
 * P2 (una sola cifra): «Lo que suma» y la barra de envío leen `cascadaDelTotal`, la misma que
 * se compara aquí con `valor_total`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/igualdad-servidor-doble'
import { COT_SAN_ANDRES, WS_TRAPPVEL } from '../../../../test/caso-san-andres'
import { tablasPorPasos, type OpcionesPorPasos } from '../../../../test/caso-por-pasos'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(), workspaceId: WS_TRAPPVEL, userId: 'p-asesora', staffId: 's-asesora',
    role: 'operator', areas: [], impersonating: false, realRole: 'operator', error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))

import { recalcularTotales, getCotizacionItems } from './cotizacion-actions'
import { opcionesDeAprobacion } from './[id]/cotizacion/actions'
import { estadoDeServicioPorPasos, elegirOpcionEnTarifa } from './por-pasos-actions'
import { contextoDeCotizacion, leerItinerarios } from '@/lib/cotizaciones/itinerarios-datos'
import {
  cascadaDelTotal,
  lineasParaLaCascada,
  loQueSuma,
  preciosDeLasOpciones,
  tarifasCalculadas,
  viajeEnOrden,
} from '@/lib/cotizaciones/por-pasos-vista'

function sembrar(o: OpcionesPorPasos = {}) {
  base.tablas = tablasPorPasos(o)
  base.secuencia = 0
  base.registro = []
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-12T15:00:00.000Z') })
})

/** Lo que tiene la página: las filas con sus rubros, los adicionales y las tarifas. */
async function loQueTieneLaPagina() {
  const filas = (await getCotizacionItems(COT_SAN_ANDRES)) as Fila[]
  const adicionales: Record<string, Fila[]> = {}
  for (const a of (base.tablas.item_adicionales ?? []) as Fila[]) {
    adicionales[a.item_id as string] = [...(adicionales[a.item_id as string] ?? []), a]
  }
  const ctx = await contextoDeCotizacion(clienteFalso(), COT_SAN_ANDRES)
  const tarifas = ((await leerItinerarios(clienteFalso(), COT_SAN_ANDRES)) ?? []).map(f => ({
    id: f.id, nombre: f.nombre, orden: f.orden, vaEnPropuesta: f.vaEnPropuesta, seleccion: f.seleccion,
  }))
  return { filas, adicionales, ctx: ctx!, tarifas }
}

async function comparar() {
  await recalcularTotales(COT_SAN_ANDRES)
  const { filas, adicionales, ctx, tarifas } = await loQueTieneLaPagina()
  const lineas = lineasParaLaCascada(filas as never, adicionales as never)
  // Las líneas de la pantalla son, campo por campo, las del servidor.
  const delServidor = [...ctx.items].sort((a, b) => a.id.localeCompare(b.id))
  const deLaPantalla = [...lineas].sort((a, b) => a.id.localeCompare(b.id))
  expect(deLaPantalla.map(l => ({ ...l, nombre: undefined, base_iva: undefined }))).toEqual(
    delServidor.map(l => ({ ...l, nombre: undefined, base_iva: undefined, tarifa_pax: l.tarifa_pax ?? null })),
  )
  const calculadas = tarifasCalculadas(lineas, ctx.params, tarifas)
  const servidor = ((await opcionesDeAprobacion(COT_SAN_ANDRES)) as { tarifas: { itinerarioId: string; precio: number }[] }).tarifas
  for (const s of servidor) {
    expect(calculadas.find(t => t.id === s.itinerarioId)?.precio, `tarifa ${s.itinerarioId}`).toBe(s.precio)
  }
  const total = cascadaDelTotal(lineas, ctx.params, tarifas).precioVenta
  expect(total).toBe(Number((base.tablas.cotizaciones[0] as Fila).valor_total))
  return { lineas, calculadas, total, filas }
}

describe('P3 · la pantalla calcula igual que el servidor', () => {
  it('el caso fijo', async () => {
    sembrar()
    await comparar()
  })

  it('el caso del flujo nuevo (traslado elegido por tarifa, traslado opcional)', async () => {
    sembrar({ caso: { flujoNuevo: true } })
    await comparar()
  })

  it('con un adicional en el vuelo de Avianca (las maletas que el editor de siempre no sumaba en pantalla)', async () => {
    sembrar()
    base.tablas.item_adicionales = [{ id: 'ad-1', item_id: 'v-avianca', codigo: 'equipaje_bodega', nombre: null, cantidad: 8, costo: 200_000, precio: 0, moneda: 'COP', tasa_cop: null, precio_manual: false }]
    const { total } = await comparar()
    expect(total).toBeGreaterThan(0)
  })

  it('V1 · sin el vuelo de SATENA', async () => {
    sembrar()
    await estadoDeServicioPorPasos(COT_SAN_ANDRES, 'vuelo 2: Vuelo San Andrés ⇄ Providencia', 'no')
    await comparar()
  })

  it('V2 · el buceo opcional, y otra lancha en la Recomendada', async () => {
    sembrar()
    await estadoDeServicioPorPasos(COT_SAN_ANDRES, 'actividad 2: Buceo de bautismo', 'opcional')
    await elegirOpcionEnTarifa('tf-recomendada', 'actividad: Cayo Cangrejo', 'a-cayo-privada')
    await comparar()
  })
})

describe('C4 · el viaje en orden y lo que suma', () => {
  it('vuelos arriba, luego Providencia y San Andrés por fecha; hotel, traslado y actividades', async () => {
    sembrar()
    const { filas } = await comparar()
    const tramos = viajeEnOrden(filas as never, { destino: 'San Andrés y Providencia', fechaInicio: '2026-11-23' })
    expect(tramos.map(t => t.titulo)).toEqual(['Vuelos', 'Providencia', 'San Andrés'])
    expect(tramos[1].servicios.map(s => s.tipo)).toEqual(['hotel', 'traslado', 'actividad'])
    expect(tramos[2].servicios.map(s => s.nombre)).toEqual(['Hotel en San Andrés', 'Traslado en San Andrés', 'Buceo de bautismo'])
  })

  it('«Lo que suma» suma exactamente el total de la cotización y tacha lo que no suma', async () => {
    sembrar()
    await estadoDeServicioPorPasos(COT_SAN_ANDRES, 'actividad 2: Buceo de bautismo', 'opcional')
    const { lineas, calculadas, total, filas } = await comparar()
    const ctx = await contextoDeCotizacion(clienteFalso(), COT_SAN_ANDRES)
    const tramos = viajeEnOrden(filas as never, { destino: null, fechaInicio: '2026-11-23' })
    const renglones = loQueSuma(tramos, calculadas, preciosDeLasOpciones(lineas, ctx!.params))
    const buceo = renglones.find(r => r.nombre === 'Buceo de bautismo')!
    expect(buceo.noSuma).toBe('Opcional: se ofrece aparte')
    expect(renglones.filter(r => !r.noSuma).reduce((a, r) => a + r.precio, 0)).toBe(total)
    // Las otras opciones dicen en qué tarifa van.
    const hotelPva = renglones.find(r => r.nombre === 'Hotel en Providencia')!
    expect(hotelPva.otras).toEqual([{ opcionId: 'h-agua-dulce', tarifas: ['Premium'] }])
  })
})
