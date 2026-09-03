/**
 * `recalcularTotales` — prueba de escritorio de los cuatro casos del encargo,
 * corriendo contra la server action real y no contra la regla pura.
 *
 * Lo que la regla pura no puede cuidar sola:
 *  1. Que el precio derivado se PERSISTA en `items.precio_venta`. Sin eso el costo
 *     sigue sumando bien y la fila, el total y el PDF siguen mostrando cero, que
 *     es exactamente el defecto.
 *  2. Que el precio derivado entre a `totalVenta` con su cantidad y su descuento.
 *  3. Que un ítem con `precio_manual = true` no se toque: la fila NO debe traer
 *     `precio_venta` en el patch, o el sistema estaría reescribiendo el mismo
 *     valor y perdería la distinción entre "no lo toqué" y "lo puse igual".
 *
 * EL DOBLE ES CONSCIENTE DE LA TABLA Y DEL FILTRO: si el código deja de filtrar
 * por `cotizacion_id`, entra el ítem de otra cotización y las cifras cambian.
 *
 * VISTOS FALLAR (2026-09-03), cada mutación tumbó pruebas:
 *   - no escribir `patch.precio_venta` → caen los casos de 3 rubros y margen 20
 *   - derivar también con `precio_manual = true` → cae "precio sobreescrito"
 *   - derivar también sin rubros → cae "ítem sin rubros"
 *   - usar `item.precio_venta` (valor viejo) al reconciliar el ajuste → cae el
 *     caso del ajuste
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: 'ws-1', error: null }),
}))

function clienteFalso() {
  return { from: (tabla: string) => constructor(tabla) }
}

function constructor(tabla: string) {
  const filtros: [string, unknown][] = []
  let operacion: 'select' | 'update' | 'delete' = 'select'
  let payload: Fila = {}
  let embebeRubros = false

  const aplica = (f: Fila) => filtros.every(([col, val]) => f[col] === val)

  const proyectar = (f: Fila) => {
    if (!embebeRubros) return { ...f }
    const rubros = (tablas.rubros ?? []).filter(r => r.item_id === f.id)
    return { ...f, rubros: rubros.map(r => ({ valor_total: r.valor_total })) }
  }

  const ejecutar = () => {
    const filas = (tablas[tabla] ?? []).filter(aplica)
    if (operacion === 'update') {
      for (const f of filas) Object.assign(f, payload)
      return { data: filas, error: null }
    }
    if (operacion === 'delete') {
      tablas[tabla] = (tablas[tabla] ?? []).filter(f => !aplica(f))
      return { data: null, error: null }
    }
    return { data: filas.map(proyectar), error: null }
  }

  const api = {
    select(cols?: string) {
      operacion = 'select'
      embebeRubros = typeof cols === 'string' && cols.includes('rubros(')
      return api
    },
    update(p: Fila) {
      operacion = 'update'
      payload = p
      return api
    },
    delete() {
      operacion = 'delete'
      return api
    },
    eq(col: string, val: unknown) {
      filtros.push([col, val])
      return api
    },
    single() {
      const { data } = ejecutar()
      return Promise.resolve({ data: (data as Fila[])?.[0] ?? null, error: null })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(ejecutar()).then(resolve, reject)
    },
  }
  return api
}

import { recalcularTotales } from './cotizacion-actions'

const COT = 'cot-1'

function sembrar(items: Fila[], rubros: Fila[], valorTotal = 0) {
  tablas = {
    cotizaciones: [{ id: COT, valor_total: valorTotal, negocio_id: 'neg-1', oportunidad_id: null }],
    items: items.map(i => ({ cotizacion_id: COT, es_ajuste: false, cantidad: 1, descuento_porcentaje: 0, ...i })),
    rubros,
  }
}

const item = (id: string) => (tablas.items ?? []).find(i => i.id === id) as Fila
const cotizacion = () => (tablas.cotizaciones ?? [])[0]

beforeEach(() => {
  tablas = {}
})

describe('recalcularTotales — cotizar por rubros', () => {
  it('3 rubros, margen 0: el ítem deja de quedar en cero', async () => {
    sembrar(
      [{ id: 'it-1', precio_venta: 0, margen_porcentaje: 0, precio_manual: false }],
      [
        { id: 'r1', item_id: 'it-1', valor_total: 500_000 },
        { id: 'r2', item_id: 'it-1', valor_total: 300_000 },
        { id: 'r3', item_id: 'it-1', valor_total: 200_000 },
      ],
    )

    const res = await recalcularTotales(COT)

    expect(item('it-1').subtotal).toBe(1_000_000)
    expect(item('it-1').precio_venta).toBe(1_000_000)
    expect(res.costoTotal).toBe(1_000_000)
    expect(res.valorVenta).toBe(1_000_000)
    expect(cotizacion().valor_total).toBe(1_000_000)
  })

  it('margen 20: el precio sube sobre el costo y el total lo refleja', async () => {
    sembrar(
      [{ id: 'it-1', precio_venta: 0, margen_porcentaje: 20, precio_manual: false }],
      [
        { id: 'r1', item_id: 'it-1', valor_total: 500_000 },
        { id: 'r2', item_id: 'it-1', valor_total: 300_000 },
        { id: 'r3', item_id: 'it-1', valor_total: 200_000 },
      ],
    )

    const res = await recalcularTotales(COT)

    expect(item('it-1').precio_venta).toBe(1_200_000)
    expect(res.costoTotal).toBe(1_000_000)
    expect(res.valorVenta).toBe(1_200_000)
  })

  it('ítem sin rubros: se comporta exactamente como hoy', async () => {
    sembrar([{ id: 'it-1', precio_venta: 750_000, margen_porcentaje: 0, precio_manual: false }], [])

    const res = await recalcularTotales(COT)

    expect(item('it-1').precio_venta).toBe(750_000)
    expect(item('it-1').subtotal).toBe(0)
    expect(res.costoTotal).toBe(0)
    expect(res.valorVenta).toBe(750_000)
  })

  it('precio sobreescrito: los rubros suman el costo y NO tocan el precio', async () => {
    sembrar(
      [{ id: 'it-1', precio_venta: 900_000, margen_porcentaje: 20, precio_manual: true }],
      [
        { id: 'r1', item_id: 'it-1', valor_total: 500_000 },
        { id: 'r2', item_id: 'it-1', valor_total: 500_000 },
      ],
    )

    const res = await recalcularTotales(COT)

    expect(item('it-1').precio_venta).toBe(900_000)
    expect(item('it-1').subtotal).toBe(1_000_000)
    expect(res.costoTotal).toBe(1_000_000)
    expect(res.valorVenta).toBe(900_000)
  })

  it('cantidad y descuento se aplican sobre el precio derivado', async () => {
    sembrar(
      [{ id: 'it-1', precio_venta: 0, margen_porcentaje: 50, precio_manual: false, cantidad: 3, descuento_porcentaje: 10 }],
      [{ id: 'r1', item_id: 'it-1', valor_total: 100_000 }],
    )

    const res = await recalcularTotales(COT)

    // Precio unitario 150.000 · 3 unidades · -10% = 405.000
    expect(item('it-1').precio_venta).toBe(150_000)
    expect(res.costoTotal).toBe(300_000)
    expect(res.valorVenta).toBe(405_000)
  })

  it('con ítem de ajuste, la reconciliación usa el precio YA derivado', async () => {
    sembrar(
      [
        { id: 'it-1', precio_venta: 0, margen_porcentaje: 0, precio_manual: false },
        { id: 'aj', es_ajuste: true, precio_venta: 900_000, orden: 9 },
      ],
      [{ id: 'r1', item_id: 'it-1', valor_total: 400_000 }],
      1_000_000, // valor_total fijado por el usuario
    )

    await recalcularTotales(COT)

    expect(item('it-1').precio_venta).toBe(400_000)
    // El ajuste cierra contra el valor fijado: 1.000.000 - 400.000
    expect(item('aj').precio_venta).toBe(600_000)
    expect(cotizacion().valor_total).toBe(1_000_000)
  })

  it('el ítem de otra cotización no entra en las cuentas', async () => {
    sembrar(
      [{ id: 'it-1', precio_venta: 0, margen_porcentaje: 0, precio_manual: false }],
      [{ id: 'r1', item_id: 'it-1', valor_total: 100_000 }],
    )
    tablas.items.push({
      id: 'ajeno', cotizacion_id: 'otra-cot', es_ajuste: false, cantidad: 1,
      descuento_porcentaje: 0, precio_venta: 9_999_999, margen_porcentaje: 0, precio_manual: true,
    })

    const res = await recalcularTotales(COT)

    expect(res.valorVenta).toBe(100_000)
  })
})
