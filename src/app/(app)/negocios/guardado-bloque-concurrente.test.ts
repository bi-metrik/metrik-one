/**
 * Dos guardados del MISMO bloque, a la vez o seguidos, dejan UNA línea de historial y
 * disparan UNA vez lo que cuelga del guardado.
 *
 * Medido el 2026-10-06 en soena: 663 pares idénticos de `activity_log` (`cambio`,
 * `bloque_datos`), la mitad a menos de 2 s. Dos causas que esta prueba cubre:
 *   - el MISMO guardado llega dos veces (Chromium repite un POST cortado, doble toque, dos
 *     pestañas): los dos leían la fila antes de que el otro escribiera y los dos se creían
 *     el primero;
 *   - un re-guardado sin cambios de un bloque ya completo (el blur de un campo que no se
 *     tocó) escribía «Bloque X completado» otra vez.
 *
 * El doble APLICA los filtros `.eq()` —incluido el de `updated_at`— y le cambia la versión
 * a la fila en cada update, como el trigger de la base. Las dos llamadas concurrentes se
 * intercalan en cada `await`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let historial: Fila[] = []
let version = 0

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
  guardEditarBloque: async () => ({ ok: true }),
  guardVerNegocio: async () => ({ ok: true }),
  guardAvanzarStage: async () => ({ ok: true }),
}))
let compartidoCon: string | null = null
vi.mock('@/lib/negocios/casilla-compartida', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/negocios/casilla-compartida')>()),
  resolverDestinoCompartido: async (_s: unknown, id: string) => compartidoCon ?? id,
}))
vi.mock('@/lib/correcciones/registrar', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/correcciones/registrar')>()),
  contextoCorreccion: async () => null,
}))
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_s: unknown, fila: Fila) => {
    historial.push(fila)
    return { ok: true, id: `log-${historial.length}` }
  },
}))
vi.mock('@/lib/actions/conciliacion-actions', () => ({
  leerModeloDineroCompleto: async () => null,
  leerModeloDineroNegocio: async () => null,
  crearCobrosSoenaCore: async () => ({ success: true }),
}))
vi.mock('@/lib/siigo/segundo-plano', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/siigo/segundo-plano')>()),
  abonarEnSegundoPlano: async () => {},
}))

function clienteFalso() {
  return { from: (tabla: string) => consulta(tabla), rpc: async () => ({ data: null, error: null }) }
}

function consulta(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let op: 'select' | 'update' | 'insert' = 'select'
  let payload: Fila | Fila[] = {}
  const ejecutar = (): Fila[] => {
    tablas[tabla] ??= []
    if (op === 'insert') {
      const filas = (Array.isArray(payload) ? payload : [payload]).map(f => ({ ...f }))
      tablas[tabla].push(...filas)
      return filas
    }
    const filas = tablas[tabla].filter(f => filtros.every(p => p(f)))
    if (op === 'update') {
      // Como el trigger `negocio_bloques_updated_at`: cada escritura es una versión nueva.
      for (const f of filas) Object.assign(f, payload, { updated_at: `v${++version}` })
      return filas.map(f => ({ id: f.id }))
    }
    return filas.map(f => structuredClone(f))
  }
  const api: Record<string, unknown> = {
    select: () => api,
    update: (p: Fila) => { op = 'update'; payload = p; return api },
    insert: (p: Fila | Fila[]) => { op = 'insert'; payload = p; return api },
    eq: (c: string, v: unknown) => { filtros.push(f => f[c] === v); return api },
    is: (c: string, v: unknown) => { filtros.push(f => (f[c] ?? null) === v); return api },
    in: (c: string, vs: unknown[]) => { filtros.push(f => vs.includes(f[c])); return api },
    order: () => api,
    limit: () => api,
    single: async () => ({ data: ejecutar()[0] ?? null, error: null }),
    maybeSingle: async () => ({ data: ejecutar()[0] ?? null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve({ data: ejecutar(), error: null }).then(res, rej),
  }
  return api
}

const { marcarBloqueCompleto } = await import('./negocio-v2-actions')

const NEG = 'neg-1'

function bloque(id: string, extra: Fila = {}, configExtra: Fila = {}): Fila {
  return {
    id,
    negocio_id: NEG,
    estado: 'pendiente',
    data: {},
    updated_at: 'v0',
    bloque_config_id: `cfg-${id}`,
    bloque_configs: {
      es_gate: false,
      slug: null,
      etapa_id: 'et-1',
      nombre: 'Titularidad',
      config_extra: { fields: [{ slug: 'nombre', type: 'text' }, { slug: 'pagos', type: 'pagos' }], ...configExtra },
      bloque_definitions: { tipo: 'datos', nombre: 'datos' },
    },
    ...extra,
  }
}

const fila = (id: string) => tablas.negocio_bloques.find(b => b.id === id) as Fila
const lineasBloque = () => historial.filter(h => h.campo_modificado === 'bloque_datos')

beforeEach(() => {
  version = 0
  historial = []
  compartidoCon = null
  tablas = { negocio_bloques: [], cobros: [], negocios: [{ id: NEG, workspace_id: 'ws-1' }], etapas_negocio: [] }
})

describe('el mismo guardado dos veces A LA VEZ', () => {
  it('deja una sola línea de historial y el bloque completo con el dato', async () => {
    tablas.negocio_bloques.push(bloque('nb-1'))
    const [a, b] = await Promise.all([
      marcarBloqueCompleto('nb-1', { nombre: 'ANA' }),
      marcarBloqueCompleto('nb-1', { nombre: 'ANA' }),
    ])
    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    expect(fila('nb-1').estado).toBe('completo')
    expect((fila('nb-1').data as Fila).nombre).toBe('ANA')
    expect(lineasBloque()).toHaveLength(1)
  })

  it('un bloque compartido (dato en el origen) tampoco duplica', async () => {
    tablas.negocio_bloques.push(bloque('nb-origen', { estado: 'completo' }), bloque('nb-copia'))
    compartidoCon = 'nb-origen'
    await Promise.all([
      marcarBloqueCompleto('nb-copia', { nombre: 'ANA' }),
      marcarBloqueCompleto('nb-copia', { nombre: 'ANA' }),
    ])
    expect(fila('nb-copia').estado).toBe('completo')
    expect((fila('nb-origen').data as Fila).nombre).toBe('ANA')
    expect(lineasBloque()).toHaveLength(1)
  })

  it('los pagos automáticos del bloque se crean una sola vez', async () => {
    tablas.negocio_bloques.push(bloque('nb-pagos', {}, { triggers: [{ event: 'complete', action: 'auto_cobros_multi' }] }))
    const pagos = [{ referencia_epayco: 'REF-1', valor_pago: 100_000 }]
    await Promise.all([
      marcarBloqueCompleto('nb-pagos', { pagos }),
      marcarBloqueCompleto('nb-pagos', { pagos }),
    ])
    expect(tablas.cobros.filter(c => c.external_ref === 'REF-1')).toHaveLength(1)
  })

  it('dos guardados DISTINTOS a la vez: gana el último y los dos quedan en el historial', async () => {
    tablas.negocio_bloques.push(bloque('nb-1'))
    await Promise.all([
      marcarBloqueCompleto('nb-1', { nombre: 'ANA' }),
      marcarBloqueCompleto('nb-1', { nombre: 'BETO' }),
    ])
    expect((fila('nb-1').data as Fila).nombre).toBe('BETO')
    expect(lineasBloque()).toHaveLength(2)
  })
})

describe('el mismo guardado dos veces SEGUIDAS', () => {
  it('el segundo, sin cambios, no deja otra línea', async () => {
    tablas.negocio_bloques.push(bloque('nb-1'))
    await marcarBloqueCompleto('nb-1', { nombre: 'ANA' })
    await marcarBloqueCompleto('nb-1', { nombre: 'ANA' })
    expect(lineasBloque()).toHaveLength(1)
  })

  it('un cambio real después sí deja su línea', async () => {
    tablas.negocio_bloques.push(bloque('nb-1'))
    await marcarBloqueCompleto('nb-1', { nombre: 'ANA' })
    await marcarBloqueCompleto('nb-1', { nombre: 'BETO' })
    expect(lineasBloque()).toHaveLength(2)
    expect(lineasBloque()[1].contenido).toMatch(/nombre/)
  })

  it('completar un bloque sin tocar campos deja su línea la primera vez', async () => {
    tablas.negocio_bloques.push(bloque('nb-1', { data: { nombre: 'ANA' } }))
    await marcarBloqueCompleto('nb-1', { nombre: 'ANA' })
    expect(lineasBloque()).toHaveLength(1)
    expect(lineasBloque()[0].contenido).toBe('Bloque "Titularidad" completado')
  })
})
