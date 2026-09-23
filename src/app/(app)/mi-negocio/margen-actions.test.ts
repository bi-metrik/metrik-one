/**
 * El guardado del margen y el recargo, contra un doble que APLICA los filtros, REGISTRA
 * lo que se escribe y reproduce las dos restricciones reales de la base:
 *
 *  1. `lineas_negocio` no admite escritura desde una sesión: su política de escritura es
 *     `false`, así que un UPDATE con el cliente de sesión devuelve CERO filas y ningún
 *     error. Así fallaba este guardado en producción hasta el 2026-09-22.
 *  2. `activity_log.entidad_tipo` tiene un CHECK: sin la migración, `linea_negocio`
 *     rebota. Se simula con `checkEntidadAmpliado = false`.
 *
 * Lo que se fija: todo cambio queda registrado con autor, anterior y nuevo, o no se
 * guarda; el aviso no puede ser menor que el mínimo; una operadora no escribe nada.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>

const WS = 'ws-trappvel'
const LINEA = 'linea-viaje'
const STAFF_EDGAR = 'staff-edgar'

let rol = 'owner'
let staffId: string | null = STAFF_EDGAR
let checkEntidadAmpliado = true
/** El servicio escribe cero filas (la línea cambió de dueño entre la lectura y la escritura). */
let servicioNoEscribe = false
let tablas: Record<string, Fila[]> = {}
const escrituras: Array<{ cliente: 'sesion' | 'servicio'; tabla: string; op: string; payload?: Fila; filas: number }> = []

function doble(quien: 'sesion' | 'servicio') {
  return {
    from: (tabla: string) => {
      const filtros: Array<(f: Fila) => boolean> = []
      let op: 'select' | 'update' | 'insert' | 'delete' = 'select'
      let payload: Fila | null = null
      const coinciden = () => (tablas[tabla] ?? []).filter(f => filtros.every(p => p(f)))

      const ejecutar = (): { data: unknown; error: { message: string; code?: string } | null } => {
        if (op === 'insert') {
          if (tabla === 'activity_log' && payload?.entidad_tipo === 'linea_negocio' && !checkEntidadAmpliado) {
            escrituras.push({ cliente: quien, tabla, op, payload: payload ?? undefined, filas: 0 })
            return { data: null, error: { code: '23514', message: 'violates check constraint "activity_log_entidad_tipo_check"' } }
          }
          const fila = { id: `log-${(tablas[tabla] ?? []).length + 1}`, created_at: '2026-09-22T20:00:00Z', ...payload }
          tablas[tabla] = [...(tablas[tabla] ?? []), fila]
          escrituras.push({ cliente: quien, tabla, op, payload: payload ?? undefined, filas: 1 })
          return { data: fila, error: null }
        }
        if (op === 'update') {
          // La política real de `lineas_negocio`: la sesión no escribe (y no se entera).
          const bloqueado = tabla === 'lineas_negocio' && (quien === 'sesion' || servicioNoEscribe)
          const afectadas = bloqueado ? [] : coinciden()
          for (const f of afectadas) Object.assign(f, payload)
          escrituras.push({ cliente: quien, tabla, op, payload: payload ?? undefined, filas: afectadas.length })
          return { data: afectadas.map(f => ({ id: f.id })), error: null }
        }
        if (op === 'delete') {
          const borrar = new Set(coinciden())
          tablas[tabla] = (tablas[tabla] ?? []).filter(f => !borrar.has(f))
          escrituras.push({ cliente: quien, tabla, op, filas: borrar.size })
          return { data: null, error: null }
        }
        return { data: coinciden(), error: null }
      }

      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        insert: (p: Fila) => { op = 'insert'; payload = p; return q },
        update: (p: Fila) => { op = 'update'; payload = p; return q },
        delete: () => { op = 'delete'; return q },
        eq: (c: string, v: unknown) => { filtros.push(f => f[c] === v); return q },
        in: (c: string, vs: unknown[]) => { filtros.push(f => vs.includes(f[c])); return q },
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
  getWorkspace: async () => ({ supabase: doble('sesion'), workspaceId: WS, role: rol, staffId, error: null }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => doble('servicio') }))

const { getMargenPorLinea, guardarRecargo, guardarUmbralesMargen } = await import('./margen-actions')

const linea = () => (tablas.lineas_negocio ?? []).find(l => l.id === LINEA)!.config_extra as Record<string, Record<string, unknown>>
const logs = () => (tablas.activity_log ?? [])

beforeEach(() => {
  rol = 'owner'
  staffId = STAFF_EDGAR
  checkEntidadAmpliado = true
  servicioNoEscribe = false
  escrituras.length = 0
  tablas = {
    lineas_negocio: [
      {
        id: LINEA,
        workspace_id: WS,
        nombre: 'Viaje a medida',
        config_extra: {
          rutas: [{ nombre: 'no tocar' }],
          margen: { piso_pct: 5, aviso_pct: 10, convencion: 'sobre_venta', default_pct: 15, provisional: true, revisar_con: 'Edgar' },
          recargo: { valor: 100000, activo: true, aplica_a: ['vuelo_detalle'], etiqueta: 'Recargo de emision', provisional: true },
        },
      },
      // Otra línea del mismo workspace que no usa estos valores (R6).
      { id: 'linea-corporativo', workspace_id: WS, nombre: 'Corporativo', config_extra: { rutas: [] } },
    ],
    etapas_negocio: [
      { linea_id: LINEA, config_extra: { gates: ['margen_sobre_piso'] } },
    ],
    activity_log: [],
  }
})

describe('Edgar cambia el margen', () => {
  it('queda escrito, sale de provisional y cada cambio queda en activity_log con autor', async () => {
    const r = await guardarUmbralesMargen(LINEA, { pisoPct: 7, avisoPct: 12 })
    expect(r).toEqual({ ok: true })

    expect(linea().margen).toMatchObject({ piso_pct: 7, aviso_pct: 12, provisional: false, convencion: 'sobre_venta', default_pct: 15 })
    expect(linea().margen).not.toHaveProperty('revisar_con')
    // Lo que la pantalla no muestra se preserva.
    expect(linea().rutas).toEqual([{ nombre: 'no tocar' }])
    expect(linea().recargo).toMatchObject({ valor: 100000, provisional: true })

    expect(logs()).toEqual([
      expect.objectContaining({
        entidad_tipo: 'linea_negocio', entidad_id: LINEA, tipo: 'cambio', autor_id: STAFF_EDGAR,
        campo_modificado: 'margen.piso_pct', valor_anterior: '5', valor_nuevo: '7',
      }),
      expect.objectContaining({ campo_modificado: 'margen.aviso_pct', valor_anterior: '10', valor_nuevo: '12' }),
    ])
  })

  it('la escritura va por el cliente de servicio: con la sesión no habría quedado nada', async () => {
    await guardarUmbralesMargen(LINEA, { pisoPct: 7, avisoPct: 12 })
    const updates = escrituras.filter(e => e.tabla === 'lineas_negocio' && e.op === 'update')
    expect(updates).toEqual([expect.objectContaining({ cliente: 'servicio', filas: 1 })])
  })

  it('confirmar sin cambiar: sale de provisional y queda la confirmación', async () => {
    const r = await guardarUmbralesMargen(LINEA, { pisoPct: 5, avisoPct: 10 })
    expect(r).toEqual({ ok: true })
    expect(linea().margen.provisional).toBe(false)
    expect(logs()).toEqual([expect.objectContaining({ campo_modificado: 'margen.provisional', autor_id: STAFF_EDGAR })])
  })
})

describe('lo que no se guarda', () => {
  it('aviso menor que el mínimo: no se guarda y se explica', async () => {
    const r = await guardarUmbralesMargen(LINEA, { pisoPct: 10, avisoPct: 5 })
    expect(r).toEqual({ error: expect.stringContaining('no puede ser menor que el mínimo') })
    expect(escrituras).toEqual([])
    expect(linea().margen).toMatchObject({ piso_pct: 5, aviso_pct: 10, provisional: true })
  })

  it('una operadora no escribe nada', async () => {
    rol = 'operator'
    const r = await guardarUmbralesMargen(LINEA, { pisoPct: 7, avisoPct: 12 })
    expect(r).toEqual({ error: expect.stringContaining('Solo el dueño') })
    const r2 = await guardarRecargo(LINEA, { activo: true, etiqueta: 'Recargo', valor: 1, vuelos: 'todos' })
    expect(r2).toEqual({ error: expect.stringContaining('Solo el dueño') })
    expect(escrituras).toEqual([])
  })

  it('sin la migración del CHECK: el registro rebota y la línea no se toca', async () => {
    checkEntidadAmpliado = false
    const r = await guardarUmbralesMargen(LINEA, { pisoPct: 7, avisoPct: 12 })
    expect(r).toEqual({ error: expect.stringContaining('no se guardó nada') })
    expect(linea().margen).toMatchObject({ piso_pct: 5, provisional: true })
    expect(escrituras.some(e => e.tabla === 'lineas_negocio')).toBe(false)
  })

  it('si la escritura no toca ninguna fila, se retira el registro: el historial no cuenta lo que no pasó', async () => {
    servicioNoEscribe = true
    const r = await guardarUmbralesMargen(LINEA, { pisoPct: 7, avisoPct: 12 })
    expect(r).toEqual({ error: expect.stringContaining('No se guardó nada') })
    // Se alcanzó a registrar y se retiró.
    expect(escrituras.filter(e => e.tabla === 'activity_log' && e.op === 'insert')).toHaveLength(2)
    expect(escrituras.filter(e => e.tabla === 'activity_log' && e.op === 'delete')).toEqual([
      expect.objectContaining({ filas: 2 }),
    ])
    expect(logs()).toEqual([])
    expect(linea().margen).toMatchObject({ piso_pct: 5, provisional: true })
  })

  it('sin ficha en el equipo no hay autor, y no se guarda', async () => {
    staffId = null
    const r = await guardarUmbralesMargen(LINEA, { pisoPct: 7, avisoPct: 12 })
    expect(r).toEqual({ error: expect.stringContaining('no se podría firmar') })
    expect(escrituras).toEqual([])
  })
})

describe('Edgar cambia el recargo', () => {
  it('valor y solo internacionales: queda escrito, preserva aplica_a y sale de provisional', async () => {
    const r = await guardarRecargo(LINEA, { activo: true, etiqueta: 'Recargo de emision', valor: 120000, vuelos: 'internacionales' })
    expect(r).toEqual({ ok: true })
    expect(linea().recargo).toEqual({
      aplica_a: ['vuelo_detalle'], activo: true, etiqueta: 'Recargo de emision', valor: 120000, vuelos: 'internacionales', provisional: false,
      // B4 · quien guarda deja escrita la base, aunque sea la de siempre.
      base: 'por_reserva',
    })
    expect(logs().map(l => l.campo_modificado)).toEqual(['recargo.valor', 'recargo.vuelos'])
    expect(linea().margen.provisional).toBe(true)
  })

  it('B4 · por pasajero: queda escrito y en el historial, dicho en palabras', async () => {
    const r = await guardarRecargo(LINEA, { activo: true, etiqueta: 'Recargo de emisión', valor: 100000, vuelos: 'todos', base: 'por_pasajero' })
    expect(r).toEqual({ ok: true })
    expect(linea().recargo).toMatchObject({ base: 'por_pasajero', provisional: false })
    const cambio = logs().find(l => l.campo_modificado === 'recargo.base')
    expect(cambio).toBeDefined()
    expect(JSON.stringify(cambio)).toContain('por cada pasajero')
  })

  it('B4 · una base que no existe: no se guarda', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await guardarRecargo(LINEA, { activo: true, etiqueta: 'R', valor: 1, vuelos: 'todos', base: 'por_vuelo' as any })
    expect(r).toEqual({ error: expect.stringContaining('por cada pasajero') })
    expect(escrituras).toEqual([])
  })

  it('una opción de vuelos que no existe: no se guarda', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await guardarRecargo(LINEA, { activo: true, etiqueta: 'R', valor: 1, vuelos: 'algunos' as any })
    expect(r).toEqual({ error: expect.stringContaining('todos o solo internacionales') })
    expect(escrituras).toEqual([])
  })
})

describe('lo que la pantalla lee', () => {
  it('solo las líneas que usan estos valores, con lo provisional y si el mínimo frena', async () => {
    const r = await getMargenPorLinea()
    if ('error' in r) throw new Error(r.error)
    expect(r.lineas.map(l => l.nombre)).toEqual(['Viaje a medida'])
    expect(r.lineas[0]).toMatchObject({
      pisoPct: 5, avisoPct: 10, margenProvisional: true, recargoProvisional: true, frenaAvance: true,
      recargo: { activo: true, valor: 100000, vuelos: 'todos' },
    })
    expect(r.puedeEditar).toBe(true)
  })

  it('después de guardar, el historial trae el cambio con su autor', async () => {
    tablas.activity_log = []
    await guardarUmbralesMargen(LINEA, { pisoPct: 7, avisoPct: 12 })
    // El doble no resuelve el embed del autor: basta con que el cambio esté y sea de la línea.
    const r = await getMargenPorLinea()
    if ('error' in r) throw new Error(r.error)
    expect(r.historial.map(h => h.contenido)).toEqual([
      'Margen mínimo para aprobar una cotización (Viaje a medida): 5% → 7%',
      'Aviso de margen bajo (Viaje a medida): 10% → 12%',
    ])
    expect(r.lineas[0].margenProvisional).toBe(false)
  })
})
