import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Caché de las RPC de Tableros. Se ejercita el `unstable_cache` REAL de Next 16.1.6
 * (la llave la arma Next, no esta prueba) sobre un almacén en memoria que imita al
 * de Vercel: guarda por llave, borra por tag y respeta `revalidate`.
 *
 * La falla que no se puede permitir es que un workspace lea cifras de otro. Por eso
 * la mitad de estas pruebas son de aislamiento.
 */

// Next instala `AsyncLocalStorage` en `globalThis` al arrancar su servidor; vitest no.
// Sin esto `unstable_cache` lanza antes de mirar el almacén.
await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks')
  ;(globalThis as unknown as { AsyncLocalStorage: unknown }).AsyncLocalStorage = AsyncLocalStorage
})

// ── Almacén en memoria con la interfaz que `unstable_cache` usa ─────────────
type Entrada = { body: string; tags: string[]; lastModified: number; revalidate: number }
const almacen = new Map<string, Entrada>()
const cacheIncremental = {
  isOnDemandRevalidate: false,
  async generateCacheKey(invocationKey: string) {
    return invocationKey
  },
  async get(key: string) {
    const e = almacen.get(key)
    if (!e) return null
    const edad = (Date.now() - e.lastModified) / 1000
    return {
      isStale: edad > e.revalidate,
      value: { kind: 'FETCH', data: { headers: {}, body: e.body, status: 200, url: '' }, revalidate: e.revalidate },
    }
  },
  async set(
    key: string,
    data: { data: { body: string }; revalidate: number },
    ctx: { tags?: string[] },
  ) {
    almacen.set(key, {
      body: data.data.body,
      tags: ctx.tags ?? [],
      lastModified: Date.now(),
      revalidate: data.revalidate,
    })
  },
  revalidarTag(tag: string) {
    for (const [k, e] of almacen) if (e.tags.includes(tag)) almacen.delete(k)
  },
}
;(globalThis as unknown as { __incrementalCache: unknown }).__incrementalCache = cacheIncremental

// `updateTag` solo corre dentro de una server action; aquí borra del almacén falso.
vi.mock('next/cache', async (original) => {
  const real = await original<typeof import('next/cache')>()
  return {
    ...real,
    updateTag: vi.fn((tag: string) => cacheIncremental.revalidarTag(tag)),
  }
})

import {
  rpcTablero,
  invalidarTablerosWorkspace,
  tagTablerosWorkspace,
  VIDA_CACHE_TABLEROS_S,
  esRespuestaVacia,
} from './cache-rpc'

const WS_A = '11111111-1111-1111-1111-111111111111'
const WS_B = '22222222-2222-2222-2222-222222222222'

/**
 * Cliente falso de Supabase. `sesionWs` es lo que respondería
 * `current_user_workspace_id()` para el JWT de ese cliente; `datos` decide qué
 * devuelve cada RPC. Cuenta las llamadas REALES a cada RPC (sin la de la guarda).
 */
function clienteDe(
  sesionWs: string | null | (() => string | null),
  datos: (fn: string, args?: Record<string, unknown>) => { data: unknown; error: unknown },
) {
  const llamadas: string[] = []
  return {
    llamadas,
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === 'current_user_workspace_id') {
        return { data: typeof sesionWs === 'function' ? sesionWs() : sesionWs, error: null }
      }
      llamadas.push(fn)
      return datos(fn, args)
    }),
  }
}

/** Datos de un workspace: llevan su id adentro, para reconocer una fuga. */
const datosDe = (ws: string) => (fn: string, args?: Record<string, unknown>) => ({
  data: { ws, fn, args },
  error: null,
})

let errores: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  almacen.clear()
  errores = vi.spyOn(console, 'error')
})
afterEach(() => {
  // Si el caché mismo falla, `rpcTablero` consulta directo y lo registra: las pruebas
  // de "no se guarda" pasarían por la razón equivocada. Ningún fallo del caché aquí.
  expect(errores).not.toHaveBeenCalled()
  vi.restoreAllMocks()
})

describe('rpcTablero: aperturas', () => {
  // Las 12 RPC tal como las pide `/tableros` en su primera apertura.
  const aperturaTableros = (ws: string) => [
    ['get_comercial_resumen_soena', { p_workspace_id: ws, p_anio: null, p_mes: null }],
    ['get_comercial_kpis_mes_soena', { p_workspace_id: ws, p_anio: 2026, p_mes: 10 }],
    ['get_comercial_kpis_mes_soena', { p_workspace_id: ws, p_anio: 2026, p_mes: 9 }],
    ['get_comercial_origen_mes_soena', { p_workspace_id: ws, p_anio: 2026, p_mes: 10, p_responsable_id: null, p_sin_responsable: false }],
    ['get_comercial_seccional_mes_soena', { p_workspace_id: ws, p_anio: 2026, p_mes: 10, p_responsable_id: null, p_sin_responsable: false }],
    ['get_comercial_plan_pago_mes_soena', { p_workspace_id: ws, p_anio: 2026, p_mes: 10, p_responsable_id: null, p_sin_responsable: false }],
    ['get_capacidad_seccional_soena', { p_workspace_id: ws, p_desde: '2026-05-01', p_hasta: '2027-01-01' }],
    ['get_comercial_serie_mensual_soena', { p_workspace_id: ws, p_meses: 12 }],
    ['get_comercial_serie_seccional_soena', { p_workspace_id: ws, p_meses: 12 }],
    ['get_comercial_serie_vendedor_soena', { p_workspace_id: ws, p_meses: 12 }],
    ['get_directivo_soena', { p_workspace_id: ws, p_anio: 2026, p_mes: 10 }],
    ['get_operaciones_bono_resumen', { p_workspace_id: ws, p_anio: 2026, p_mes: 10 }],
  ] as const

  it('la primera apertura va a la base 12 veces y la segunda, cero', async () => {
    const cliente = clienteDe(WS_A, datosDe(WS_A))
    const abrir = () =>
      Promise.all(aperturaTableros(WS_A).map(([fn, p]) => rpcTablero(cliente, WS_A, fn, { ...p })))

    const primera = await abrir()
    expect(cliente.llamadas).toHaveLength(12)

    // Otra persona del MISMO workspace, con su propio cliente, ya no consulta.
    const otraPersona = clienteDe(WS_A, datosDe(WS_A))
    const segunda = await Promise.all(
      aperturaTableros(WS_A).map(([fn, p]) => rpcTablero(otraPersona, WS_A, fn, { ...p })),
    )
    expect(otraPersona.llamadas).toHaveLength(0)
    expect(segunda).toEqual(primera)
  })

  it('cambiar un parámetro es otra entrada', async () => {
    const cliente = clienteDe(WS_A, datosDe(WS_A))
    await rpcTablero(cliente, WS_A, 'get_comercial_kpis_mes_soena', { p_workspace_id: WS_A, p_anio: 2026, p_mes: 10 })
    const otroMes = await rpcTablero(cliente, WS_A, 'get_comercial_kpis_mes_soena', { p_workspace_id: WS_A, p_anio: 2026, p_mes: 9 })
    expect(cliente.llamadas).toHaveLength(2)
    expect((otroMes.data as { args: { p_mes: number } }).args.p_mes).toBe(9)
  })

  it('el recorte por vendedor es otra entrada', async () => {
    const cliente = clienteDe(WS_A, datosDe(WS_A))
    const base = { p_workspace_id: WS_A, p_anio: 2026, p_mes: 10 }
    await rpcTablero(cliente, WS_A, 'get_comercial_origen_mes_soena', { ...base, p_responsable_id: null, p_sin_responsable: false })
    await rpcTablero(cliente, WS_A, 'get_comercial_origen_mes_soena', { ...base, p_responsable_id: null, p_sin_responsable: true })
    await rpcTablero(cliente, WS_A, 'get_comercial_origen_mes_soena', { ...base, p_responsable_id: 'abc', p_sin_responsable: false })
    expect(cliente.llamadas).toHaveLength(3)
  })
})

describe('rpcTablero: dos workspaces nunca comparten entrada', () => {
  it('misma RPC y mismos parámetros en A y en B: cada uno recibe lo suyo', async () => {
    const a = clienteDe(WS_A, datosDe(WS_A))
    const b = clienteDe(WS_B, datosDe(WS_B))
    // Parámetros IDÉNTICOS a propósito (la RPC de perfil no lleva p_workspace_id):
    // lo único que separa las entradas es el workspace de la llave.
    const params = { p_responsable_id: null, p_anio: 2026, p_mes: 10 }

    const deA = await rpcTablero(a, WS_A, 'get_comercial_perfil_soena', params)
    const deB = await rpcTablero(b, WS_B, 'get_comercial_perfil_soena', params)

    expect((deA.data as { ws: string }).ws).toBe(WS_A)
    expect((deB.data as { ws: string }).ws).toBe(WS_B)
    expect(b.llamadas).toHaveLength(1) // B fue a la base: no le sirvieron lo de A

    // Y las dos entradas quedan vivas, cada una con lo suyo.
    const deA2 = await rpcTablero(clienteDe(WS_A, datosDe('X')), WS_A, 'get_comercial_perfil_soena', params)
    const deB2 = await rpcTablero(clienteDe(WS_B, datosDe('X')), WS_B, 'get_comercial_perfil_soena', params)
    expect((deA2.data as { ws: string }).ws).toBe(WS_A)
    expect((deB2.data as { ws: string }).ws).toBe(WS_B)
  })

  it('cada entrada guardada lleva el workspace en la llave y en el tag', async () => {
    await rpcTablero(clienteDe(WS_A, datosDe(WS_A)), WS_A, 'get_directivo_soena', { p_workspace_id: WS_A, p_anio: 2026, p_mes: 10 })
    await rpcTablero(clienteDe(WS_B, datosDe(WS_B)), WS_B, 'get_directivo_soena', { p_workspace_id: WS_B, p_anio: 2026, p_mes: 10 })
    expect(almacen.size).toBe(2)
    for (const [llave, e] of almacen) {
      const ws = llave.includes(WS_A) ? WS_A : WS_B
      expect(llave).toContain(`ws:${ws}`)
      expect(e.tags).toEqual([tagTablerosWorkspace(ws)])
      expect(e.body).toContain(ws)
      expect(e.body).not.toContain(ws === WS_A ? WS_B : WS_A)
    }
  })

  it('un JWT de B pidiendo como A no deja nada guardado bajo A', async () => {
    // El caso de la RPC de perfil, que resuelve el workspace por la sesión y no por
    // parámetro: si la sesión es de B, la respuesta es de B. Nunca puede quedar
    // guardada bajo la llave de A.
    const sesionDeB = clienteDe(WS_B, datosDe(WS_B))
    const r = await rpcTablero(sesionDeB, WS_A, 'get_comercial_perfil_soena', { p_responsable_id: null, p_anio: 2026, p_mes: 10 })
    expect((r.data as { ws: string }).ws).toBe(WS_B) // se devuelve lo que la base dijo, como antes
    expect(almacen.size).toBe(0)

    const deA = clienteDe(WS_A, datosDe(WS_A))
    const r2 = await rpcTablero(deA, WS_A, 'get_comercial_perfil_soena', { p_responsable_id: null, p_anio: 2026, p_mes: 10 })
    expect(deA.llamadas).toHaveLength(1)
    expect((r2.data as { ws: string }).ws).toBe(WS_A)
  })

  it('si la sesión cambia de workspace mientras corre la RPC, no se guarda', async () => {
    let actual: string = WS_A
    const cliente = clienteDe(
      () => actual,
      (fn, args) => {
        actual = WS_B // otra pestaña cambió de workspace a mitad de camino
        return datosDe(WS_A)(fn, args)
      },
    )
    await rpcTablero(cliente, WS_A, 'get_directivo_soena', { p_workspace_id: WS_A, p_anio: 2026, p_mes: 10 })
    expect(almacen.size).toBe(0)
  })

  it('invalidar el tag de A no toca las cifras de B', async () => {
    const params = (ws: string) => ({ p_workspace_id: ws, p_anio: 2026, p_mes: 10 })
    await rpcTablero(clienteDe(WS_A, datosDe(WS_A)), WS_A, 'get_operaciones_bono_resumen', params(WS_A))
    await rpcTablero(clienteDe(WS_B, datosDe(WS_B)), WS_B, 'get_operaciones_bono_resumen', params(WS_B))

    invalidarTablerosWorkspace(WS_A)

    const a = clienteDe(WS_A, datosDe(WS_A))
    const b = clienteDe(WS_B, datosDe(WS_B))
    await rpcTablero(a, WS_A, 'get_operaciones_bono_resumen', params(WS_A))
    await rpcTablero(b, WS_B, 'get_operaciones_bono_resumen', params(WS_B))
    expect(a.llamadas).toHaveLength(1) // A se recalcula
    expect(b.llamadas).toHaveLength(0) // B sigue en caché
  })
})

describe('rpcTablero: lo que no se guarda', () => {
  const params = { p_workspace_id: WS_A, p_meses: 12 }

  it('service_role (guarda en null): devuelve lo de la base y no lo guarda', async () => {
    const servicio = clienteDe(null, () => ({ data: { ventas: 0 }, error: null }))
    const r = await rpcTablero(servicio, WS_A, 'get_comercial_serie_mensual_soena', params)
    expect(r.data).toEqual({ ventas: 0 })
    expect(almacen.size).toBe(0)

    // La siguiente persona real NO recibe los ceros de la guarda.
    const real = clienteDe(WS_A, () => ({ data: { ventas: 30 }, error: null }))
    const r2 = await rpcTablero(real, WS_A, 'get_comercial_serie_mensual_soena', params)
    expect(r2.data).toEqual({ ventas: 30 })
  })

  it('un error no se guarda y llega igual a la acción', async () => {
    const falla = clienteDe(WS_A, () => ({ data: null, error: { message: 'timeout' } }))
    const r = await rpcTablero(falla, WS_A, 'get_comercial_serie_mensual_soena', params)
    expect(r).toEqual({ data: null, error: { message: 'timeout' } })
    expect(almacen.size).toBe(0)
  })

  it('una respuesta vacía no se guarda', async () => {
    for (const vacia of [null, [], {}]) {
      const c = clienteDe(WS_A, () => ({ data: vacia, error: null }))
      const r = await rpcTablero(c, WS_A, 'get_comercial_resumen_soena', { p_workspace_id: WS_A, p_anio: null, p_mes: null })
      expect(r.data).toEqual(vacia)
    }
    expect(almacen.size).toBe(0)
  })

  it('esRespuestaVacia', () => {
    expect(esRespuestaVacia(null)).toBe(true)
    expect(esRespuestaVacia(undefined)).toBe(true)
    expect(esRespuestaVacia([])).toBe(true)
    expect(esRespuestaVacia({})).toBe(true)
    expect(esRespuestaVacia([{}])).toBe(false)
    expect(esRespuestaVacia({ total: 0 })).toBe(false)
    expect(esRespuestaVacia(0)).toBe(false)
  })
})

describe('rpcTablero: vida de 5 minutos', () => {
  it('pasada la ventana de 5 minutos vuelve a la base (no sirve la vencida)', async () => {
    const t0 = Date.UTC(2026, 9, 3, 18, 0, 0) // inicio exacto de una ventana
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(t0)
    const params = { p_workspace_id: WS_A, p_anio: 2026, p_mes: 10 }

    const c1 = clienteDe(WS_A, datosDe(WS_A))
    await rpcTablero(c1, WS_A, 'get_directivo_soena', params)

    reloj.mockReturnValue(t0 + (VIDA_CACHE_TABLEROS_S - 1) * 1000)
    const c2 = clienteDe(WS_A, datosDe(WS_A))
    await rpcTablero(c2, WS_A, 'get_directivo_soena', params)
    expect(c2.llamadas).toHaveLength(0)

    reloj.mockReturnValue(t0 + VIDA_CACHE_TABLEROS_S * 1000)
    const c3 = clienteDe(WS_A, datosDe(WS_A))
    await rpcTablero(c3, WS_A, 'get_directivo_soena', params)
    expect(c3.llamadas).toHaveLength(1)
  })
})
