/**
 * El costo a mano en otra moneda, contra un doble de Supabase que PERSISTE: se afirma lo que
 * quedó escrito en `items`, no lo que la acción dice haber hecho.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let estadoDeLaCotizacion = 'borrador'

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: clienteFalso(), workspaceId: 'ws-1', userId: 'p-1', error: null }),
}))
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({ recalcularTotales: async () => {} }))

function clienteFalso() {
  return { from: (tabla: string) => consulta(tabla) }
}

function consulta(tabla: string) {
  const filtros: [string, unknown][] = []
  let operacion: 'select' | 'update' = 'select'
  let payload: Fila = {}
  let embebe = false
  const aplica = (f: Fila) => filtros.every(([c, v]) => f[c] === v)
  const ejecutar = () => {
    const filas = (tablas[tabla] ?? []).filter(aplica)
    if (operacion === 'update') {
      for (const f of filas) Object.assign(f, structuredClone(payload))
      return { data: filas, error: null }
    }
    return {
      data: filas.map(f => ({
        ...structuredClone(f),
        ...(embebe ? { cotizaciones: { estado: estadoDeLaCotizacion, negocio_id: 'neg-1' } } : {}),
      })),
      error: null,
    }
  }
  const api = {
    select(cols?: string) { embebe = typeof cols === 'string' && cols.includes('cotizaciones('); return api },
    update(p: Fila) { operacion = 'update'; payload = p; return api },
    eq(c: string, v: unknown) { filtros.push([c, v]); return api },
    async maybeSingle() { const r = ejecutar(); return { data: (r.data as Fila[])[0] ?? null, error: null } },
    then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(ejecutar()).then(res, rej) },
  }
  return api
}

const { guardarCostoManualEnMoneda } = await import('./costo-manual-actions')
const { leerTarifaPax } = await import('@/lib/cotizaciones/tarifa-pasajero')

const item = () => (tablas.items ?? []).find(f => f.id === 'item-1') as Fila

beforeEach(() => {
  estadoDeLaCotizacion = 'borrador'
  tablas = {
    items: [{ id: 'item-1', cotizacion_id: 'cot-1', es_ajuste: false, subtotal: 0, tarifa_pax: null }],
    rubros: [],
    profiles: [{ id: 'p-1', full_name: 'Alejandra' }],
  }
})

describe('el costo a mano de una línea de viaje, en su moneda', () => {
  it('USD con tasa: `subtotal` en pesos y lo escrito anotado, con quién', async () => {
    const r = await guardarCostoManualEnMoneda('item-1', { valor: 120, moneda: 'USD', tasa: 4150 })
    expect(r.success).toBe(true)
    expect(item().subtotal).toBe(498000)
    expect(leerTarifaPax(item().tarifa_pax).costoManual).toMatchObject({ moneda: 'USD', valor: 120, tasa: 4150, por: 'Alejandra' })
  })

  it('volver a COP deja los pesos y retira la anotación', async () => {
    await guardarCostoManualEnMoneda('item-1', { valor: 120, moneda: 'USD', tasa: 4150 })
    await guardarCostoManualEnMoneda('item-1', { valor: 500000, moneda: 'COP', tasa: null })
    expect(item().subtotal).toBe(500000)
    expect(leerTarifaPax(item().tarifa_pax).costoManual).toBeUndefined()
  })

  it('en otra moneda sin tasa no se escribe nada', async () => {
    const r = await guardarCostoManualEnMoneda('item-1', { valor: 120, moneda: 'USD', tasa: null })
    expect(r.success).toBe(false)
    expect(item().subtotal).toBe(0)
    expect(item().tarifa_pax).toBeNull()
  })

  it('con rubros confirmados, o fuera de borrador, no hay costo a mano', async () => {
    tablas.rubros = [{ item_id: 'item-1', sugerido: false }]
    expect((await guardarCostoManualEnMoneda('item-1', { valor: 1, moneda: 'COP', tasa: null })).success).toBe(false)
    tablas.rubros = []
    estadoDeLaCotizacion = 'enviada'
    expect((await guardarCostoManualEnMoneda('item-1', { valor: 1, moneda: 'COP', tasa: null })).success).toBe(false)
    expect(item().subtotal).toBe(0)
  })

  it('no se lleva lo que ya había en la tarifa de la línea (casillas, moneda elegida)', async () => {
    item().tarifa_pax = { moneda: { valor: 'USD', por: null, porId: null, en: '2026-09-22T10:00:00Z' } }
    await guardarCostoManualEnMoneda('item-1', { valor: 100, moneda: 'EUR', tasa: 4500 })
    const t = leerTarifaPax(item().tarifa_pax)
    expect(t.moneda?.valor).toBe('USD')
    expect(t.costoManual?.moneda).toBe('EUR')
  })
})
