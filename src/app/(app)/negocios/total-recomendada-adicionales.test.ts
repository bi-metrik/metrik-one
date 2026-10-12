/**
 * Riesgo R1 de la cotización integrada: «COT-2026-0025 no toma el total de su Recomendada».
 *
 * ## Lo que se sospechaba
 *
 * Con una sola tarifa «Recomendada» y `va_en_propuesta = true`, `recalcularTotales` tiene que
 * escribir el total de esa tarifa (`idDelPrincipal` → `totalDelPrincipal`). En producción
 * COT-2026-0025 tenía `valor_total` = $22.213.630 y la Recomendada se midió en ≈ $20.331.278,
 * así que parecía que el servidor caía al total «por supuesto».
 *
 * ## Lo que pasa de verdad
 *
 * El servidor SÍ toma la Recomendada. La diferencia, $1.882.352, son los ADICIONALES de sus
 * líneas (`item_adicionales`: maletas, sillas…): $1.600.000 de costo con el 15 % sobre venta.
 * La cascada los suma (`precioConAdicionales`); la medición de ≈ $20.331.278 sumó solo
 * `items.precio_venta`, que no los incluye. 20.331.278 + 1.882.352 = 22.213.630, al peso.
 *
 * Esta prueba lo fija sobre la forma de COT-0025 (anonimizada, con el caso fijo de C0 sin
 * actividades): seis servicios, dos hoteles con dos opciones, vuelos y traslados de una sola
 * opción, ninguna tarifa con `es_principal`, Económica fuera de la propuesta, Recomendada y
 * Premium dentro, cada tarifa nombrando solo sus hoteles. Las opciones de la Premium van
 * PRIMERO por `orden`, así que el total por supuesto es otro número y no se puede confundir.
 *
 * Los adicionales del caso (8 maletas de $200.000) son inventados: reproducen la cifra, no
 * dicen cuáles son los de producción.
 *
 * ## Se vio fallar
 *
 *  · `idDelPrincipal` devolviendo `null` → `valor_total` cae al supuesto ($26.721.560) y caen
 *    la primera y la segunda.
 *  · `adjuntarAdicionales` devolviendo las líneas sin adicionales → `valor_total` baja a
 *    $20.331.278 y cae la segunda.
 */
import { describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, type Fila } from '../../../../test/igualdad-servidor-doble'
import { COT_SAN_ANDRES, WS_TRAPPVEL, tablasCasoSanAndres } from '../../../../test/caso-san-andres'

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(), workspaceId: WS_TRAPPVEL, userId: 'p-asesora', staffId: 's-asesora',
    role: 'operator', areas: [], impersonating: false, realRole: 'operator', error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))

import { recalcularTotales } from './cotizacion-actions'
import { opcionesDeAprobacion } from './[id]/cotizacion/actions'

/** La forma de COT-0025: el caso fijo sin actividades, con la Premium primera en cada hotel. */
function formaCot0025(opts: { recomendadaVa?: boolean; conAdicionales?: boolean } = {}): Record<string, Fila[]> {
  const t = tablasCasoSanAndres()
  const esActividad = (id: unknown) => String(id).startsWith('a-')
  t.items = t.items.filter(i => !esActividad(i.id))
  t.rubros = t.rubros.filter(r => !esActividad(r.item_id))
  t.itinerario_opciones = t.itinerario_opciones.filter(o => !esActividad(o.item_id))
  const orden: Record<string, number> = { 'h-agua-dulce': 3, 'h-posada': 4, 'h-lord-pierre': 5, 'h-verde-mar': 6 }
  for (const i of t.items) if (orden[i.id as string]) i.orden = orden[i.id as string]
  if (opts.recomendadaVa === false) {
    for (const f of t.cotizacion_itinerarios) if (f.id === 'tf-recomendada') f.va_en_propuesta = false
  }
  if (opts.conAdicionales !== false) {
    t.item_adicionales = [{
      id: 'ad-maletas', item_id: 'v-avianca', codigo: 'equipaje_bodega', nombre: null, cantidad: 8,
      costo: 200_000, precio: 0, moneda: 'COP', tasa_cop: null, origen: 'manual', orden: 1, precio_manual: false,
    }]
  }
  return t
}

async function recalcular(tablas: Record<string, Fila[]>) {
  base.tablas = tablas
  base.registro = []
  base.secuencia = 0
  const r = await recalcularTotales(COT_SAN_ANDRES)
  expect(r.success).toBe(true)
  const cot = base.tablas.cotizaciones[0] as Fila
  const tarifas = (await opcionesDeAprobacion(COT_SAN_ANDRES)) as { tarifas: { nombre: string; precio: number }[] }
  const precioDe = (nombre: string) => tarifas.tarifas.find(t => t.nombre === nombre)?.precio
  return { valorTotal: Number(cot.valor_total), costoTotal: Number(cot.costo_total), precioDe }
}

/** Lo que mide quien suma `items.precio_venta` de la Recomendada, y lo que esa suma deja fuera. */
function sumasDeLaRecomendada() {
  const elegidos = new Set(base.tablas.itinerario_opciones.filter(o => o.itinerario_id === 'tf-recomendada').map(o => o.item_id))
  const lineas = base.tablas.items.filter(i => !String(i.grupo).startsWith('hotel') || elegidos.has(i.id))
  const ids = new Set(lineas.map(i => i.id))
  const precioVenta = lineas.reduce((a, i) => a + Number(i.precio_venta) * Number(i.cantidad), 0)
  const adicionales = base.tablas.item_adicionales
    .filter(a => ids.has(a.item_id))
    .reduce((a, x) => a + Number(x.precio) * Number(x.cantidad), 0)
  return { precioVenta, adicionales }
}

describe('R1 · COT-2026-0025: el total es el de la Recomendada, con sus adicionales', () => {
  it('valor_total es el precio de la Recomendada y no el supuesto', async () => {
    const supuesto = (await recalcular(formaCot0025({ recomendadaVa: false }))).valorTotal
    const { valorTotal, precioDe } = await recalcular(formaCot0025())
    expect(valorTotal).toBe(precioDe('Recomendada'))
    expect(valorTotal).not.toBe(supuesto)
    // Sin principal, el supuesto toma la primera pegada de cada hotel: aquí, las de la Premium.
    expect(supuesto).toBe(precioDe('Premium'))
  })

  it('la diferencia con la suma de precio_venta son los adicionales, al peso', async () => {
    const { valorTotal, costoTotal } = await recalcular(formaCot0025())
    const { precioVenta, adicionales } = sumasDeLaRecomendada()
    expect(adicionales).toBe(1_882_352)
    expect(valorTotal).toBe(precioVenta + adicionales)
    // Las cifras de producción: ≈ 20.331.278 medido por precio_venta, 22.213.630 escrito.
    expect(precioVenta).toBe(20_331_278)
    expect(valorTotal).toBe(22_213_630)
    expect(costoTotal).toBe(17_281_590 + 1_600_000)
  })

  it('sin adicionales, la suma de precio_venta y el total coinciden', async () => {
    const { valorTotal, precioDe } = await recalcular(formaCot0025({ conAdicionales: false }))
    expect(valorTotal).toBe(precioDe('Recomendada'))
    expect(valorTotal).toBe(sumasDeLaRecomendada().precioVenta)
  })
})
