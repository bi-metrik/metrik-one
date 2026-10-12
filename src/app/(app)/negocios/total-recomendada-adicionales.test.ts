/**
 * Riesgo R1 de la cotización integrada: «el total de la cotización no es el de su Recomendada».
 *
 * ## La regla
 *
 * Con una sola tarifa «Recomendada» y `va_en_propuesta = true`, `recalcularTotales` escribe el
 * total de esa tarifa (`idDelPrincipal` → `totalDelPrincipal`). Ese total es la suma de
 * `items.precio_venta` de sus líneas **más los adicionales de esas líneas**
 * (`item_adicionales.precio × cantidad`): la cascada cobra `precioConAdicionales`.
 *
 * Medir una tarifa sumando solo `precio_venta` la deja corta exactamente en sus adicionales, y
 * la diferencia se lee como «el servidor no tomó la Recomendada». Eso fue lo que pasó en R1.
 *
 * El caso es el fijo de C0 (sintético), con las opciones de la Premium PRIMERO por `orden` en
 * cada hotel, para que el total por supuesto sea otro número, y un adicional inventado en el
 * primer vuelo.
 *
 * ## Se vio fallar
 *
 *  · `idDelPrincipal` devolviendo `null` → `valor_total` cae al supuesto y caen las tres.
 *  · `adjuntarAdicionales` devolviendo las líneas sin adicionales → cae la segunda.
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

/** Cifras inventadas del adicional: 5 unidades de $150.000 de costo. */
const ADICIONAL = { cantidad: 5, costo: 150_000 }

const seleccionDe = (t: Record<string, Fila[]>, tarifa: string) =>
  new Set(t.itinerario_opciones.filter(o => o.itinerario_id === tarifa).map(o => o.item_id))

/** El caso fijo, con las opciones de la Premium primero en cada ranura y, si se pide, un adicional. */
function caso(opts: { recomendadaVa?: boolean; conAdicional?: boolean } = {}): Record<string, Fila[]> {
  const t = tablasCasoSanAndres()
  const premium = seleccionDe(t, 'tf-premium')
  // En cada ranura con opciones, la de la Premium pasa a tener el `orden` más bajo.
  const porGrupo = new Map<string, Fila[]>()
  for (const i of t.items) porGrupo.set(i.grupo as string, [...(porGrupo.get(i.grupo as string) ?? []), i])
  for (const filas of porGrupo.values()) {
    if (filas.length < 2) continue
    const ordenes = filas.map(f => Number(f.orden)).sort((a, b) => a - b)
    const primero = [...filas.filter(f => premium.has(f.id)), ...filas.filter(f => !premium.has(f.id))]
    primero.forEach((f, k) => { f.orden = ordenes[k] })
  }
  if (opts.recomendadaVa === false) {
    for (const f of t.cotizacion_itinerarios) if (f.id === 'tf-recomendada') f.va_en_propuesta = false
  }
  if (opts.conAdicional !== false) {
    const vuelo = [...t.items].filter(i => String(i.grupo).startsWith('vuelo')).sort((a, b) => Number(a.orden) - Number(b.orden))[0]
    t.item_adicionales = [{
      id: 'ad-1', item_id: vuelo.id, codigo: 'equipaje_bodega', nombre: null, cantidad: ADICIONAL.cantidad,
      costo: ADICIONAL.costo, precio: 0, moneda: 'COP', tasa_cop: null, origen: 'manual', orden: 1, precio_manual: false,
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
  return { valorTotal: Number(cot.valor_total), precioDe }
}

/** Las líneas de la Recomendada: las fijas más las que ella elige en cada ranura con opciones. */
function sumasDeLaRecomendada() {
  const elegidas = seleccionDe(base.tablas, 'tf-recomendada')
  const grupos = new Map<string, number>()
  for (const i of base.tablas.items) grupos.set(i.grupo as string, (grupos.get(i.grupo as string) ?? 0) + 1)
  const lineas = base.tablas.items.filter(i => grupos.get(i.grupo as string) === 1 || elegidas.has(i.id))
  const ids = new Set(lineas.map(i => i.id))
  const precioVenta = lineas.reduce((a, i) => a + Number(i.precio_venta) * Number(i.cantidad), 0)
  const adicionales = base.tablas.item_adicionales
    .filter(a => ids.has(a.item_id))
    .reduce((a, x) => a + Number(x.precio) * Number(x.cantidad), 0)
  return { precioVenta, adicionales }
}

describe('R1 · el total de la cotización es el de la Recomendada, con sus adicionales', () => {
  it('valor_total es el precio de la Recomendada y no el supuesto', async () => {
    const supuesto = (await recalcular(caso({ recomendadaVa: false }))).valorTotal
    const { valorTotal, precioDe } = await recalcular(caso())
    expect(valorTotal).toBe(precioDe('Recomendada'))
    expect(valorTotal).not.toBe(supuesto)
    // Sin principal, el supuesto toma la primera opción de cada ranura: aquí, las de la Premium.
    expect(supuesto).toBe(precioDe('Premium'))
  })

  it('valor_total = suma de precio_venta de sus líneas + sus adicionales', async () => {
    const { valorTotal } = await recalcular(caso())
    const { precioVenta, adicionales } = sumasDeLaRecomendada()
    // El adicional sin precio a mano toma el margen global (15 % sobre venta), por unidad.
    expect(adicionales).toBe(ADICIONAL.cantidad * Math.round(ADICIONAL.costo / 0.85))
    expect(adicionales).toBeGreaterThan(0)
    expect(valorTotal).toBe(precioVenta + adicionales)
    // Sumar solo precio_venta la deja corta justo en los adicionales.
    expect(valorTotal - precioVenta).toBe(adicionales)
  })

  it('sin adicionales, la suma de precio_venta y el total coinciden', async () => {
    const { valorTotal, precioDe } = await recalcular(caso({ conAdicional: false }))
    expect(valorTotal).toBe(precioDe('Recomendada'))
    expect(valorTotal).toBe(sumasDeLaRecomendada().precioVenta)
  })
})
