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
    // `recalcularTotales` lee asi la convencion de margen de la cotizacion. Sin
    // esto el doble no responde y la funcion se cae antes de tocar un item.
    maybeSingle() {
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
    // Explícito: el default del producto es `sobre_venta`. Esta prueba mide la
    // aritmética del recargo sobre el costo, no cuál es el default.
    cotizacion().convencion_margen = 'markup'

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

  it('el descuento del ítem baja el costo, no el precio', async () => {
    sembrar(
      [{ id: 'it-1', precio_venta: 0, margen_porcentaje: 50, precio_manual: false, cantidad: 3, descuento_porcentaje: 10 }],
      [{ id: 'r1', item_id: 'it-1', valor_total: 100_000 }],
    )
    cotizacion().convencion_margen = 'markup'

    const res = await recalcularTotales(COT)

    // El descuento del ítem es de COMPRA: 100.000 · 3 · -10% = 270.000 de costo.
    // Con 50% de margen el precio sigue siendo 405.000, el mismo de antes: lo que
    // cambia es que el costo ya no reporta 300.000 que nadie va a pagar.
    expect(res.costoTotal).toBe(270_000)
    expect(res.valorVenta).toBe(405_000)
    expect(item('it-1').precio_venta).toBe(135_000) // unitario: 405.000 / 3
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

describe('recalcularTotales — la convención vive en la cotización', () => {
  it('sin convención declarada usa el default del producto: sobre venta', async () => {
    // 1.000.000 / 0,85. Lo ya cotizado no se mueve porque la migración le fijó
    // `markup` explícito a toda cotización anterior al cambio de default.
    sembrar([{ id: 'i1', margen_porcentaje: 15 }], [{ item_id: 'i1', valor_total: 1_000_000 }])
    await recalcularTotales(COT)
    expect(item('i1').precio_venta).toBe(1_176_471)
  })

  it('con markup declarado, el 15 escrito es un recargo sobre el costo', async () => {
    sembrar([{ id: 'i1', margen_porcentaje: 15 }], [{ item_id: 'i1', valor_total: 1_000_000 }])
    cotizacion().convencion_margen = 'markup'
    await recalcularTotales(COT)
    expect(item('i1').precio_venta).toBe(1_150_000)
  })

  it('con sobre_venta el 15 escrito ES el margen real del ítem', async () => {
    sembrar([{ id: 'i1', margen_porcentaje: 15 }], [{ item_id: 'i1', valor_total: 1_000_000 }])
    cotizacion().convencion_margen = 'sobre_venta'
    await recalcularTotales(COT)
    // 1.000.000 / 0,85 — el divisor con el que cotiza la agencia
    expect(item('i1').precio_venta).toBe(1_176_471)
  })

  it('la convención llega hasta el total de la cotización, no solo al ítem', async () => {
    sembrar([{ id: 'i1', margen_porcentaje: 15, cantidad: 2 }], [{ item_id: 'i1', valor_total: 1_000_000 }])
    cotizacion().convencion_margen = 'sobre_venta'
    await recalcularTotales(COT)
    // 2.000.000 / 0,85 = 2.352.941,17. El redondeo se hace al PRECIO UNITARIO, que es
    // la cifra que se imprime: 1.176.471 × 2 = 2.352.942. Redondear el total exacto
    // daría 2.352.941 y la columna del PDF sumaría un peso más que el "TOTAL NETO".
    expect(item('i1').precio_venta).toBe(1_176_471)
    expect(cotizacion().valor_total).toBe(2_352_942)
  })

  // EL CASO QUE IMPORTA: el cliente recibe un PDF con una columna de valores y un
  // total, y suma la columna. En COT-2026-0003 de Termotech los 12 ítems sumaban
  // 153.655.471 contra un "TOTAL NETO" de 153.655.469: dos pesos, pero un documento
  // que no cuadra consigo mismo. Un solo ítem no lo destapa; hacen falta varios con
  // decimales que se acumulen en la misma dirección.
  it('la columna que ve el cliente suma EXACTAMENTE el total de la cotización', async () => {
    sembrar(
      [
        { id: 'i1', margen_porcentaje: 23.99, cantidad: 1 },
        { id: 'i2', margen_porcentaje: 23.99, cantidad: 3 },
        { id: 'i3', margen_porcentaje: 23.99, cantidad: 7 },
      ],
      [
        { item_id: 'i1', valor_total: 12_495_000 },
        { item_id: 'i2', valor_total: 885_289 },
        { item_id: 'i3', valor_total: 615_852 },
      ],
    )
    await recalcularTotales(COT)

    const sumaDeLaColumna = ['i1', 'i2', 'i3'].reduce((s, id) => {
      const fila = item(id) as { precio_venta: number; cantidad?: number }
      return s + fila.precio_venta * (fila.cantidad ?? 1)
    }, 0)
    expect(sumaDeLaColumna).toBe(cotizacion().valor_total)
  })
})
