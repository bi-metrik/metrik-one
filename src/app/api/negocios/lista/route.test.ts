/**
 * `GET /api/negocios/lista`: la sesión se resuelve UNA vez por petición, y un fallo de
 * Supabase responde 500 en lugar de una lista vacía con 200.
 *
 * `getWorkspace` se reemplaza por uno que cuenta cuántas veces se resuelve la sesión, con el
 * mismo cableado que el real: `memoDeRuta(impl)` (el contrato lo fija
 * `memo-de-ruta.test.ts`). Medido con este arnés el 2026-10-03: sin `enPeticionDeRuta` la
 * ruta resolvía la sesión 4 veces por petición (`leerUniverso`, las dos `getNegociosV2` y
 * `getEtapasSegmentador`); con él, 1.
 *
 * La base es un doble mínimo: cada tabla responde lo que diga `respuestas`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type Respuesta = { data: unknown; error: { message: string } | null }
let respuestas: Record<string, Respuesta>
let sesiones = 0

function consulta(tabla: string) {
  const r = () => respuestas[tabla] ?? { data: [], error: null }
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'order', 'not', 'is', 'gte', 'lte', 'range', 'limit']) chain[m] = () => chain
  chain.single = async () => r()
  chain.maybeSingle = async () => r()
  chain.then = (ok: (v: Respuesta) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(r()).then(ok, ko)
  return chain
}
const supabase = { from: consulta, rpc: async () => ({ data: [], error: null }) }

vi.mock('@/lib/actions/get-workspace', async () => {
  const { memoDeRuta } = await import('@/lib/actions/memo-de-ruta')
  return {
    getWorkspace: memoDeRuta(async () => {
      sesiones++
      return { supabase, workspaceId: 'ws-1', userId: 'u-1', role: 'owner', staffId: 's-1', areas: [], error: null }
    }),
  }
})
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))

const { GET } = await import('./route')

const pedir = (q = '') => GET(new NextRequest(`https://soena.metrikone.co/api/negocios/lista${q}`))

beforeEach(() => {
  sesiones = 0
  respuestas = {
    negocios: { data: [], error: null },
    workspaces: { data: { config_extra: {}, linea_activa_id: null }, error: null },
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/negocios/lista', () => {
  it('resuelve la sesión una sola vez por petición', async () => {
    const r = await pedir('?desde=0')
    expect(r.status).toBe(200)
    expect(sesiones).toBe(1)
  })

  it('también al pedir los ids (Excel y Drive)', async () => {
    const r = await pedir('?solo=ids')
    expect(r.status).toBe(200)
    expect(sesiones).toBe(1)
  })

  it('una falla de Supabase en los negocios da 500, no una lista vacía', async () => {
    respuestas.negocios = { data: null, error: { message: 'canceling statement due to statement timeout' } }
    const r = await pedir('?desde=0')
    expect(r.status).toBe(500)
    expect(await r.json()).not.toHaveProperty('tarjetas')
  })

  it('una falla de Supabase en las etapas también da 500', async () => {
    respuestas.workspaces = { data: { config_extra: {}, linea_activa_id: 'l-1' }, error: null }
    respuestas.etapas_negocio = { data: null, error: { message: 'boom' } }
    const r = await pedir('?desde=0')
    expect(r.status).toBe(500)
  })

  it('los ids de la lista tampoco salen vacíos con una falla', async () => {
    respuestas.negocios = { data: null, error: { message: 'boom' } }
    const r = await pedir('?solo=ids')
    expect(r.status).toBe(500)
  })

  it('sin falla y sin negocios, 200 con la lista vacía (eso sí es "sin negocios")', async () => {
    const r = await pedir('?desde=0')
    expect(r.status).toBe(200)
    const v = await r.json()
    expect(v.tarjetas).toEqual([])
  })
})
