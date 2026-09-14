/**
 * Dos huecos del cronograma que quedaron fuera de #677.
 *
 * - `reevaluarBloqueCronograma` recibía del navegador si el bloque exige todas las
 *   fechas. Quien tuviera permiso de edición podía mandar `false` y dar por completo un
 *   cronograma sin fechas. Ahora la regla sale de `config_extra.require_all_dates` del
 *   bloque, y un segundo argumento se ignora.
 * - `leerVersionCronograma` solo tenía la RLS de su tabla, que acota por workspace y
 *   nada más. Ahora pasa por `guardVerNegocio`, el mismo acceso que la página: la tarjeta
 *   la pide al montar para cualquiera que abra el negocio, así que el guard es el de
 *   VER y no el de editar.
 *
 * El revert en pantalla de BloqueCronograma cuando el servidor rechaza no tiene prueba
 * aquí: vitest corre en `node`, sin DOM, y no hay forma de ejercitar un clic ni una
 * transición sin montar esa infraestructura.
 *
 * EL DOBLE APLICA LOS FILTROS `.eq()` Y EL ORDEN, así que la versión que devuelve es la
 * que devolvería la base, no la primera fila del arreglo.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let lecturas: string[] = []
let puedeEditar = true
let puedeVer = true

const guardEditarBloque = vi.fn(async (_negocioBloqueId: string) =>
  puedeEditar ? { ok: true } : { ok: false, error: 'Tu rol o área no permite editar en esta fase del negocio' },
)
const guardVerNegocio = vi.fn(async (_negocioId: string) =>
  puedeVer ? { ok: true } : { ok: false, error: 'Sin acceso a este negocio' },
)

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(),
    workspaceId: 'ws-1',
    userId: 'user-1',
    staffId: 'staff-1',
    error: null,
  }),
}))

vi.mock('@/lib/permissions/guard-negocio', () => ({
  guardEditarBloque: (id: string) => guardEditarBloque(id),
  guardVerNegocio: (id: string) => guardVerNegocio(id),
  guardAvanzarStage: async () => ({ ok: true }),
}))

function clienteFalso() {
  return { from: (tabla: string) => constructor(tabla) }
}

function constructor(tabla: string) {
  const filtros: [string, unknown][] = []
  let operacion: 'select' | 'update' = 'select'
  let payload: Fila = {}
  let limite: number | null = null
  let orden: { col: string; asc: boolean } | null = null

  const aplica = (f: Fila) => filtros.every(([col, val]) => f[col] === val)

  const ejecutar = (): Fila[] => {
    const filas = (tablas[tabla] ?? []).filter(aplica)
    if (operacion === 'update') {
      for (const f of filas) Object.assign(f, payload)
      return filas
    }
    lecturas.push(tabla)
    let vistas = filas.map(f => ({ ...f }))
    if (orden) {
      const { col, asc } = orden
      vistas = [...vistas].sort((a, b) => (Number(a[col]) - Number(b[col])) * (asc ? 1 : -1))
    }
    return limite === null ? vistas : vistas.slice(0, limite)
  }

  const api = {
    select() {
      return api
    },
    update(p: Fila) {
      operacion = 'update'
      payload = p
      return api
    },
    eq(col: string, val: unknown) {
      filtros.push([col, val])
      return api
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orden = { col, asc: opts?.ascending ?? true }
      return api
    },
    limit(n: number) {
      limite = n
      return api
    },
    single() {
      return Promise.resolve({ data: ejecutar()[0] ?? null, error: null })
    },
    maybeSingle() {
      return Promise.resolve({ data: ejecutar()[0] ?? null, error: null })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve({ data: ejecutar(), error: null }).then(resolve, reject)
    },
  }
  return api
}

import { reevaluarBloqueCronograma, leerVersionCronograma } from './negocio-v2-actions'

const NEGOCIO = 'neg-1'

function bloque(id: string, estado: string, configExtra: Fila, negocioId = NEGOCIO): Fila {
  return { id, negocio_id: negocioId, estado, bloque_configs: { config_extra: configExtra } }
}

const estadoDe = (id: string) => tablas.negocio_bloques.find(b => b.id === id)?.estado

// Firma vieja: el navegador mandaba la regla. Un llamador todavía puede mandarla.
const reevaluarConArgumentoDelCliente = reevaluarBloqueCronograma as unknown as (
  id: string,
  requireAllDates: boolean,
) => ReturnType<typeof reevaluarBloqueCronograma>

beforeEach(() => {
  puedeEditar = true
  puedeVer = true
  lecturas = []
  guardEditarBloque.mockClear()
  guardVerNegocio.mockClear()
  tablas = {
    negocio_bloques: [
      bloque('nb-exige-fechas', 'completo', { require_all_dates: true }),
      bloque('nb-sin-regla', 'pendiente', {}),
      bloque('nb-exige-completo', 'pendiente', { require_all_dates: true }),
      bloque('nb-otro-negocio', 'pendiente', {}, 'neg-otro'),
      bloque('nb-sin-versiones', 'pendiente', {}),
    ],
    bloque_items: [
      { id: 'it-1', negocio_bloque_id: 'nb-exige-fechas', fecha_inicio: '2026-09-20', fecha_fin: null },
      { id: 'it-2', negocio_bloque_id: 'nb-sin-regla', fecha_inicio: null, fecha_fin: null },
      { id: 'it-3', negocio_bloque_id: 'nb-exige-completo', fecha_inicio: '2026-09-20', fecha_fin: '2026-09-25' },
    ],
    cronograma_versiones: [
      { negocio_bloque_id: 'nb-exige-fechas', numero: 1, created_at: '2026-09-10T10:00:00Z', cambios: ['Paso nuevo: Montaje'] },
      { negocio_bloque_id: 'nb-exige-fechas', numero: 2, created_at: '2026-09-12T10:00:00Z', cambios: ['Montaje: fin 20 sept → 25 sept'] },
      { negocio_bloque_id: 'nb-otro-negocio', numero: 1, created_at: '2026-09-11T10:00:00Z', cambios: [] },
    ],
  }
})

describe('reevaluarBloqueCronograma: la regla de fechas sale de la config', () => {
  it('la config exige todas las fechas y el navegador manda false: un paso sin fin deja el bloque pendiente', async () => {
    const r = await reevaluarConArgumentoDelCliente('nb-exige-fechas', false)
    expect(r).toEqual({ error: null })
    expect(estadoDe('nb-exige-fechas')).toBe('pendiente')
  })

  it('la config no exige fechas y el navegador manda true: con un paso el bloque queda completo', async () => {
    const r = await reevaluarConArgumentoDelCliente('nb-sin-regla', true)
    expect(r).toEqual({ error: null })
    expect(estadoDe('nb-sin-regla')).toBe('completo')
  })

  it('la config exige todas las fechas y están todas: completo', async () => {
    const r = await reevaluarBloqueCronograma('nb-exige-completo')
    expect(r).toEqual({ error: null })
    expect(estadoDe('nb-exige-completo')).toBe('completo')
  })
})

describe('leerVersionCronograma: el guard de ver el negocio', () => {
  it('quien no puede ver el negocio no recibe la versión, y la tabla de versiones no se consulta', async () => {
    puedeVer = false
    const v = await leerVersionCronograma('nb-exige-fechas')
    expect(v).toBeNull()
    expect(guardVerNegocio).toHaveBeenCalledWith(NEGOCIO)
    expect(lecturas).not.toContain('cronograma_versiones')
  })

  it('quien ve el negocio sin permiso de edición sí recibe el sello, y es la última versión', async () => {
    puedeEditar = false
    const v = await leerVersionCronograma('nb-exige-fechas')
    expect(v).toEqual({
      numero: 2,
      created_at: '2026-09-12T10:00:00Z',
      cambios: ['Montaje: fin 20 sept → 25 sept'],
    })
    expect(guardEditarBloque).not.toHaveBeenCalled()
  })

  it('el guard mira el negocio DEL BLOQUE', async () => {
    await leerVersionCronograma('nb-otro-negocio')
    expect(guardVerNegocio).toHaveBeenCalledWith('neg-otro')
  })

  it('bloque inexistente: null, sin guard ni lectura de versiones', async () => {
    const v = await leerVersionCronograma('no-existe')
    expect(v).toBeNull()
    expect(guardVerNegocio).not.toHaveBeenCalled()
    expect(lecturas).not.toContain('cronograma_versiones')
  })

  it('bloque sin versiones: el guard corre igual y devuelve null', async () => {
    const v = await leerVersionCronograma('nb-sin-versiones')
    expect(v).toBeNull()
    expect(guardVerNegocio).toHaveBeenCalledWith(NEGOCIO)
  })
})
