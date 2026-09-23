/**
 * La ranura y el flujo de captura del lado del servidor (Parte B y flujo de Noor, brief de
 * captura del 2026-09-23), contra un doble que APLICA los filtros y GUARDA lo que se escribe.
 *
 * Lo que se fija:
 *  1. La ranura nace con su nombre y su primera opción («Hotel en Cancún» → «Opción 1»); sin
 *     la tabla todavía (migración pendiente) la opción se crea igual con su grupo.
 *  2. Una opción nueva es HERMANA: nunca copia el nombre de la vecina, cuelga de la misma
 *     ranura y, si las viejas no tenían ranura, la ranura nace con todas.
 *  3. Las tres tarifas se reparten por precio y las completas nacen en la propuesta.
 *  4. El recargo por pasajero se cobra por los que viajan; por reserva, una vez.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContextoCotizacion, ItemDeCotizacion } from '@/lib/cotizaciones/itinerarios-datos'
import { UMBRALES_MARGEN_POR_DEFECTO } from '@/lib/cotizaciones/convencion-margen'

type Fila = Record<string, unknown>

const WS = 'ws-trappvel'
const COT = 'cot-1'
const NEG = 'neg-1'

/** Las tablas que «no existen»: toda operación sobre ellas devuelve el error de PostgREST. */
let tablasAusentes = new Set<string>()
let tablas: Record<string, Fila[]> = {}
let secuencia = 0
let composicion: { adultos: number; ninos: number; infantes: number } | null = null
let ctxActual: ContextoCotizacion | null = null

function doble() {
  return {
    from: (tabla: string) => {
      const filtros: Array<(f: Fila) => boolean> = []
      let op: 'select' | 'update' | 'insert' | 'delete' = 'select'
      let payload: Fila | Fila[] | null = null
      const coinciden = () => (tablas[tabla] ?? []).filter(f => filtros.every(p => p(f)))

      const ejecutar = (): { data: unknown; error: { message: string; code?: string } | null } => {
        if (tablasAusentes.has(tabla)) {
          return { data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${tabla}'` } }
        }
        if (op === 'insert') {
          const nuevas = (Array.isArray(payload) ? payload : [payload]).map(p => ({ id: `${tabla}-${++secuencia}`, ...p }))
          tablas[tabla] = [...(tablas[tabla] ?? []), ...nuevas]
          return { data: nuevas, error: null }
        }
        if (op === 'update') {
          const afectadas = coinciden()
          for (const f of afectadas) Object.assign(f, payload)
          return { data: afectadas, error: null }
        }
        if (op === 'delete') {
          const borrar = new Set(coinciden())
          tablas[tabla] = (tablas[tabla] ?? []).filter(f => !borrar.has(f))
          return { data: null, error: null }
        }
        // El embed que lee `leerItinerarios`: cada tarifa con sus opciones elegidas.
        if (tabla === 'cotizacion_itinerarios') {
          return {
            data: coinciden().map(f => ({
              ...f,
              itinerario_opciones: (tablas.itinerario_opciones ?? []).filter(o => o.itinerario_id === f.id),
            })),
            error: null,
          }
        }
        return { data: coinciden(), error: null }
      }

      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        insert: (p: Fila | Fila[]) => { op = 'insert'; payload = p; return q },
        update: (p: Fila) => { op = 'update'; payload = p; return q },
        delete: () => { op = 'delete'; return q },
        eq: (c: string, v: unknown) => { filtros.push(f => f[c] === v); return q },
        in: (c: string, vs: unknown[]) => { filtros.push(f => vs.includes(f[c])); return q },
        single: async () => {
          const r = ejecutar()
          return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }
        },
        maybeSingle: async () => {
          const r = ejecutar()
          return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }
        },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(ejecutar()).then(ok, ko),
      }
      return q
    },
  }
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: doble(), workspaceId: WS, role: 'owner', staffId: 'staff-1', error: null }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => doble() }))
vi.mock('@/lib/cotizaciones/viaje-negocio', () => ({
  leerViajeDelNegocio: async () => ({
    viaje: { destino: 'Cancún', composicion, fechas: { inicio: null, fin: null }, presentacion: null, nivelDetalle: 'normal' },
    error: null,
  }),
}))
vi.mock('@/app/(app)/negocios/cotizacion-actions', () => ({ recalcularTotales: async () => ({ success: true }) }))
vi.mock('@/lib/cotizaciones/piso-salida-datos', () => ({ revisarExcepcionTrasCambio: async () => {} }))
vi.mock('@/lib/cotizaciones/itinerarios-datos', async (original) => ({
  ...(await original<typeof import('@/lib/cotizaciones/itinerarios-datos')>()),
  contextoDeCotizacion: async () => ctxActual,
}))

const { crearRanuraConOpcion, agregarOpcionARanura, eliminarRanura } = await import('./ranura-actions')
const { armarTarifas } = await import('./itinerario-actions')
const { aplicarRecargo } = await import('./recargo-actions')

const items = () => (tablas.items ?? []).filter(i => i.cotizacion_id === COT)
const ranuras = () => tablas.cotizacion_ranuras ?? []

beforeEach(() => {
  tablasAusentes = new Set()
  secuencia = 0
  composicion = { adultos: 2, ninos: 1, infantes: 1 }
  ctxActual = null
  tablas = {
    cotizaciones: [{ id: COT, estado: 'borrador', negocio_id: NEG, oportunidad_id: null }],
    items: [],
    cotizacion_ranuras: [],
    cotizacion_itinerarios: [],
    itinerario_opciones: [],
    negocios: [{ id: NEG, lineas_negocio: { config_extra: {} } }],
  }
})

describe('crear una ranura desde la zona de pegado', () => {
  it('nace con su nombre y su primera opción, hermana de nadie y sin margen propio', async () => {
    const r = await crearRanuraConOpcion(COT, 'hotel', { lugar: 'Cancún' })
    expect(r).toMatchObject({ success: true })
    expect(items()).toHaveLength(1)
    const [opcion] = items()
    expect(opcion).toMatchObject({ nombre: 'OPCIÓN 1', opcion_de: null, margen_porcentaje: null, subtotal: 0 })
    expect(ranuras()).toEqual([expect.objectContaining({ cotizacion_id: COT, workspace_id: WS, tipo: 'hotel', nombre: 'Hotel en Cancún' })])
    // La línea cuelga de su ranura, y el grupo (lo que decide el total) dice lo mismo.
    expect(opcion.ranura_id).toBe(ranuras()[0].id)
    expect(String(opcion.grupo)).toContain('Hotel en Cancún')
  })

  it('un segundo hotel del mismo viaje es OTRA ranura, que suma aparte', async () => {
    await crearRanuraConOpcion(COT, 'hotel', { lugar: 'Cancún' })
    await crearRanuraConOpcion(COT, 'hotel', { lugar: 'Cancún' })
    expect(ranuras()).toHaveLength(2)
    const [a, b] = items()
    expect(a.grupo).not.toBe(b.grupo)
    expect(ranuras()[1]).toMatchObject({ numero: 2 })
  })

  it('sin la tabla de ranuras (migración pendiente) la opción se crea igual, con su grupo', async () => {
    tablasAusentes = new Set(['cotizacion_ranuras'])
    const r = await crearRanuraConOpcion(COT, 'vuelo', { origen: 'Bogotá', destino: 'Cancún' })
    expect(r).toMatchObject({ success: true })
    expect(items()).toHaveLength(1)
    expect(items()[0].ranura_id).toBeUndefined()
    expect(String(items()[0].grupo)).toMatch(/^vuelo/)
  })

  it('una cotización ya enviada no gana opciones', async () => {
    tablas.cotizaciones[0].estado = 'enviada'
    const r = await crearRanuraConOpcion(COT, 'hotel', {})
    expect(r).toMatchObject({ success: false })
    expect(items()).toHaveLength(0)
    expect(ranuras()).toHaveLength(0)
  })
})

describe('otra opción de la misma ranura (paso 2 de Noor)', () => {
  it('es hermana: no copia el nombre de la vecina y cuelga de la misma ranura', async () => {
    await crearRanuraConOpcion(COT, 'hotel', { lugar: 'Cancún' })
    const [primera] = items()
    Object.assign(primera, { nombre: 'RIU PALACE', unidad: 'noche', cantidad: 5 })
    const r = await agregarOpcionARanura(COT, primera.grupo as string)
    expect(r).toMatchObject({ success: true })
    const nueva = items().find(i => i.id !== primera.id)!
    expect(nueva.nombre).toBe('OPCIÓN 2')
    expect(nueva.nombre).not.toContain('RIU')
    expect(nueva).toMatchObject({ grupo: primera.grupo, opcion_de: null, unidad: 'noche', cantidad: 5, ranura_id: primera.ranura_id })
    expect(ranuras()).toHaveLength(1)
  })

  it('opciones viejas sin ranura: la ranura nace con TODAS, no solo con la nueva', async () => {
    tablas.items = [
      { id: 'viejo-1', cotizacion_id: COT, grupo: 'hotel', nombre: 'CROWN', orden: 1, opcion_de: null },
      { id: 'viejo-2', cotizacion_id: COT, grupo: 'hotel', nombre: 'SUNSCAPE', orden: 2, opcion_de: 'viejo-1' },
    ]
    const r = await agregarOpcionARanura(COT, 'hotel')
    expect(r).toMatchObject({ success: true })
    expect(ranuras()).toHaveLength(1)
    const id = ranuras()[0].id
    expect(items().map(i => i.ranura_id)).toEqual([id, id, id])
  })

  it('un grupo que no es ranura del catálogo se rechaza sin escribir', async () => {
    tablas.items = [{ id: 'x', cotizacion_id: COT, grupo: 'avianca bog - adz', nombre: 'AVIANCA', orden: 1 }]
    const r = await agregarOpcionARanura(COT, 'avianca bog - adz')
    expect(r).toMatchObject({ success: false })
    expect(items()).toHaveLength(1)
  })
})

// ── Pasos 4 y 5: tarifas por precio, las completas nacen marcadas ──────────────

function opcion(id: string, grupo: string, costo: number | null, orden: number): ItemDeCotizacion {
  return {
    id,
    nombre: id.toUpperCase(),
    grupo,
    opcion_de: null,
    es_ajuste: false,
    orden,
    dia_relativo: null,
    entra_al_precio: true,
    cantidad: 1,
    subtotal: costo ?? 0,
    numeroDeRubros: costo === null ? 0 : 1,
    costoDeRubros: costo ?? 0,
    descuento_porcentaje: 0,
    margen_porcentaje: null,
    precio_venta: 0,
    precio_manual: false,
    adicionales: [],
  }
}

function contexto(lista: ItemDeCotizacion[]): ContextoCotizacion {
  return {
    items: lista,
    params: { administrativosPct: 0, margenPct: 20, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' },
    umbrales: UMBRALES_MARGEN_POR_DEFECTO,
    negocioId: NEG,
    oportunidadId: null,
  }
}

const elegidasDe = (nombre: string) => {
  const tarifa = (tablas.cotizacion_itinerarios ?? []).find(t => t.nombre === nombre)!
  return (tablas.itinerario_opciones ?? []).filter(o => o.itinerario_id === tarifa.id).map(o => o.item_id)
}

describe('armar las tres tarifas', () => {
  it('se reparten por precio: la barata en la Económica, la del medio en la Recomendada, la cara en la Premium', async () => {
    // Orden de carga distinto del de precio: el reparto no puede depender de quién se pegó primero.
    ctxActual = contexto([
      opcion('hyatt', 'hotel', 3_000_000, 1),
      opcion('crown', 'hotel', 1_000_000, 2),
      opcion('sunscape', 'hotel', 2_000_000, 3),
      opcion('avianca', 'vuelo', 800_000, 4),
      opcion('latam', 'vuelo', 900_000, 5),
    ])
    const r = await armarTarifas(COT)
    expect(r).toMatchObject({ success: true, creadas: 3 })
    expect(elegidasDe('Económica').sort()).toEqual(['avianca', 'crown'])
    // Con dos opciones la Recomendada es la más barata de las dos (posición (n-1)/2 hacia abajo).
    expect(elegidasDe('Recomendada').sort()).toEqual(['avianca', 'sunscape'])
    expect(elegidasDe('Premium').sort()).toEqual(['hyatt', 'latam'])
  })

  it('las completas nacen en la propuesta (paso 5): nadie marca tres casillas', async () => {
    ctxActual = contexto([
      opcion('crown', 'hotel', 1_000_000, 1),
      opcion('hyatt', 'hotel', 3_000_000, 2),
    ])
    const r = await armarTarifas(COT)
    expect(r).toMatchObject({ success: true, marcadas: ['Económica', 'Recomendada', 'Premium'], sinMarcar: [] })
    expect((tablas.cotizacion_itinerarios ?? []).every(t => t.va_en_propuesta === true)).toBe(true)
  })

  it('una ranura sin ninguna opción con precio deja las tres SIN marcar, y dice por qué', async () => {
    ctxActual = contexto([
      opcion('crown', 'hotel', 1_000_000, 1),
      opcion('hyatt', 'hotel', 3_000_000, 2),
      // Dos opciones de vuelo todavía sin pantallazo: nada que repartir ahí.
      opcion('op1', 'vuelo', null, 3),
      opcion('op2', 'vuelo', null, 4),
    ])
    const r = await armarTarifas(COT) as { success: boolean; marcadas: string[]; sinMarcar: { nombre: string; motivo: string }[] }
    expect(r.success).toBe(true)
    expect(r.marcadas).toEqual([])
    expect(r.sinMarcar.map(s => s.nombre)).toEqual(['Económica', 'Recomendada', 'Premium'])
    expect(r.sinMarcar.every(s => s.motivo.length > 0)).toBe(true)
    expect((tablas.cotizacion_itinerarios ?? []).some(t => t.va_en_propuesta === true)).toBe(false)
    // Lo que sí tenía precio quedó repartido: el hotel no se pierde por culpa del vuelo.
    expect(elegidasDe('Económica')).toEqual(['crown'])
  })

  it('las que ya existían no se tocan ni se vuelven a marcar', async () => {
    tablas.cotizacion_itinerarios = [{ id: 'ya', cotizacion_id: COT, nombre: 'Económica', orden: 1, va_en_propuesta: false, es_principal: false }]
    ctxActual = contexto([
      opcion('crown', 'hotel', 1_000_000, 1),
      opcion('hyatt', 'hotel', 3_000_000, 2),
    ])
    const r = await armarTarifas(COT)
    expect(r).toMatchObject({ success: true, creadas: 2, yaExistian: 1 })
    expect(tablas.cotizacion_itinerarios.find(t => t.id === 'ya')!.va_en_propuesta).toBe(false)
  })
})

// ── B4 · el recargo por reserva o por pasajero ────────────────────────────────

describe('B4 · aplicar el recargo', () => {
  const conRecargo = (base?: string) => {
    tablas.negocios = [{
      id: NEG,
      lineas_negocio: { config_extra: { recargo: { activo: true, etiqueta: 'Recargo de emisión', valor: 100_000, aplica_a: ['vuelo_detalle'], ...(base ? { base } : {}) } } },
    }]
    tablas.items = [{ id: 'v', cotizacion_id: COT, grupo: 'vuelo', nombre: 'AVIANCA', orden: 1, precio_venta: 0, cantidad: 1 }]
  }
  const linea = () => items().find(i => i.nombre === 'Recargo de emisión')

  it('por reserva (lo de siempre): una vez, viajen cuantos viajen', async () => {
    conRecargo()
    const r = await aplicarRecargo(COT)
    expect(r).toMatchObject({ success: true, valor: 100_000 })
    expect(linea()).toMatchObject({ precio_venta: 100_000, cantidad: 1, unidad: 'servicio', grupo: null, precio_manual: true })
  })

  it('por pasajero: el valor por cada uno de los que viajan, infantes incluidos', async () => {
    conRecargo('por_pasajero')
    const r = await aplicarRecargo(COT)
    expect(r).toMatchObject({ success: true, valor: 400_000 })
    expect(linea()).toMatchObject({ precio_venta: 100_000, cantidad: 4, unidad: 'pax' })
  })

  it('por pasajero sin saber quiénes viajan: no se agrega y se dice qué falta', async () => {
    conRecargo('por_pasajero')
    composicion = null
    const r = await aplicarRecargo(COT)
    expect(r).toMatchObject({ success: false })
    expect((r as { error: string }).error).toContain('quiénes viajan')
    expect(linea()).toBeUndefined()
  })
})

describe('eliminar un bloque entero (P12)', () => {
  it('borra todas sus opciones y la fila de la ranura; el otro bloque y el ajuste quedan', async () => {
    await crearRanuraConOpcion(COT, 'hotel', { lugar: 'Cancún' })
    const [primera] = items()
    await agregarOpcionARanura(COT, primera.grupo as string)
    await crearRanuraConOpcion(COT, 'vuelo', { origen: 'Bogotá', destino: 'Cancún' })
    tablas.items.push({ id: 'ajuste', cotizacion_id: COT, grupo: primera.grupo, es_ajuste: true, orden: 99 })
    expect(ranuras()).toHaveLength(2)

    const r = await eliminarRanura(COT, primera.grupo as string)
    expect(r).toMatchObject({ success: true, borradas: 2 })
    expect(items().filter(i => i.es_ajuste !== true).map(i => String(i.grupo))).toEqual([expect.stringMatching(/^vuelo/)])
    expect(items().some(i => i.id === 'ajuste')).toBe(true)
    expect(ranuras()).toHaveLength(1)
    expect(ranuras()[0]).toMatchObject({ tipo: 'vuelo' })
  })

  it('no toca las líneas de otra cotización con el mismo grupo', async () => {
    await crearRanuraConOpcion(COT, 'hotel', { lugar: 'Cancún' })
    const [primera] = items()
    tablas.items.push({ id: 'ajena', cotizacion_id: 'otra', grupo: primera.grupo, orden: 1 })
    await eliminarRanura(COT, primera.grupo as string)
    expect(tablas.items.map(i => i.id)).toEqual(['ajena'])
  })

  it('una cotización ya enviada no pierde bloques', async () => {
    await crearRanuraConOpcion(COT, 'hotel', { lugar: 'Cancún' })
    tablas.cotizaciones[0].estado = 'enviada'
    const r = await eliminarRanura(COT, items()[0].grupo as string)
    expect(r).toMatchObject({ success: false })
    expect(items()).toHaveLength(1)
  })
})
