/**
 * Barrido ámbar (2026-10-22), A1 + A6: el avance de etapa devuelve TODO lo que falta en un solo
 * aviso, en el orden de siempre, en vez de una familia de gates a la vez.
 *
 * Visto en E8 de «Viaje a medida»: con saldo pendiente solo salía «Saldo pendiente»; al saldar
 * aparecía recién entonces la confirmación del cierre.
 *
 * Se llama la acción del servidor contra un doble de la base. Los evaluadores de cada familia se
 * sustituyen por interruptores: lo que se prueba es cómo la acción los junta, no su criterio
 * (cada uno tiene sus propias pruebas).
 *
 * VISTO FALLAR (2026-10-22), una mutación a la vez:
 *   · volver a `return` en `saldo_cero` → cae «E8 con saldo pendiente y sin cierre…»;
 *   · empujar el cierre ANTES del saldo → cae el mismo (orden);
 *   · quitar la línea del error de lectura del saldo → cae «una lectura que falla sigue frenando»;
 *   · quitar la llamada a `evaluarGateCotizacionRequerida` → cae «cotizacion_requerida se suma…».
 *
 * Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>

const WS = 'ws-viajes'
const NEG = 'neg-1'
const E8 = 'etapa-8'
const E9 = 'etapa-9'

let tablas: Record<string, Fila[]> = {}
let role = 'admin'
let lecturaSaldo: { ok: true; saldo: Record<string, unknown> } | { ok: false; error: string } = { ok: true, saldo: {} }
let faltaCierre: string[] = []
const moverEtapa = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: cliente(), workspaceId: WS, userId: 'p-1', staffId: 's-1', role, areas: ['operaciones'],
    impersonating: false, realRole: role, error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente(), createClient: async () => cliente() }))
vi.mock('@/lib/modulos/exigir-modulo', async () => (await import('../../../../test/exigir-modulo-doble')).dobleExigirModulo())
vi.mock('@/lib/permissions/guard-negocio', () => ({
  guardEditarBloque: async () => ({ ok: true }),
  guardVerNegocio: async () => ({ ok: true }),
  guardAvanzarStage: async () => ({ ok: true }),
}))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => ({ ok: true, id: 'a-1' }) }))
vi.mock('@/lib/negocios/documentos-leyendo', () => ({ documentosLeyendo: async () => [], mensajeDocumentoLeyendo: (n: string) => n }))
vi.mock('@/lib/negocios/datos-clave-servidor', () => ({
  datosClaveDelNegocio: async () => null,
  contradiccionesQueBloquean: async () => [],
}))
vi.mock('@/lib/correcciones/retroceso', async (orig) => ({ ...(await orig<Record<string, unknown>>()), leerAviso: async () => null }))
vi.mock('@/lib/cobros/saldo-cero-datos', () => ({ leerSaldoCero: async () => lecturaSaldo }))
vi.mock('@/lib/viaje/cierre-viaje-datos', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  evaluarGateCierre: async (_db: unknown, a: { gates: string[] }) => (a.gates.includes('margen_confirmado') ? faltaCierre : []),
}))

function cliente() {
  return {
    from: (t: string) => consulta(t),
    rpc: async (fn: string) => ({ data: fn === 'puede_avanzar_etapa' ? true : [], error: null }),
  }
}

function consulta(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let op: 'select' | 'update' | 'insert' = 'select'
  let conteo = false
  const correr = () => {
    const filas = (tablas[tabla] ?? []).filter((f) => filtros.every((fn) => fn(f)))
    if (op !== 'select') {
      if (tabla === 'negocios' && op === 'update') moverEtapa()
      return { data: filas, error: null, count: null }
    }
    return { data: conteo ? null : filas.map((f) => ({ ...f })), error: null, count: filas.length }
  }
  const q: Record<string, unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) conteo = true; return q },
    update: () => { op = 'update'; return q },
    insert: () => { op = 'insert'; return q },
    eq: (c: string, v: unknown) => { if (!c.includes('.')) filtros.push((f) => !(c in f) || f[c] === v); return q },
    neq: () => q, is: () => q, not: () => q, in: () => q, gte: () => q, lte: () => q, or: () => q,
    order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: (correr().data as Fila[] | null)?.[0] ?? null, error: null }),
    single: async () => {
      const f = (correr().data as Fila[] | null)?.[0]
      return f ? { data: f, error: null } : { data: null, error: { message: 'sin fila' } }
    },
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(correr()).then(ok, ko),
  }
  return q
}

import { reiniciarModulo, MODULES } from '../../../../test/exigir-modulo-doble'
import { cambiarEtapaNegocioConGate } from './negocio-v2-actions'
import { mensajeSaldoCero } from '@/lib/cobros/saldo-cero'
import { MENSAJE_GATE_COTIZACION_REQUERIDA } from '@/lib/negocios/gate-cotizacion-requerida'

const SALDO_PENDIENTE = { precio: 1_000_000, recaudado: 400_000, saldo: 600_000, sinConfirmar: 0, cubierto: false }
const SALDO_CUBIERTO = { precio: 1_000_000, recaudado: 1_000_000, saldo: 0, sinConfirmar: 0, cubierto: true }
const FALTA_CIERRE = 'Falta que la dirección confirme el cierre'

function sembrar(gatesE8: string[]) {
  role = 'admin'
  lecturaSaldo = { ok: true, saldo: SALDO_PENDIENTE }
  faltaCierre = [FALTA_CIERRE]
  moverEtapa.mockClear()
  reiniciarModulo(WS, { ...MODULES.termotech })
  tablas = {
    workspaces: [{ id: WS, modules: {}, config_extra: {} }],
    negocios: [{ id: NEG, workspace_id: WS, etapa_actual_id: E8, stage_actual: 'ejecucion', precio_aprobado: 1_000_000 }],
    etapas_negocio: [
      { id: E8, linea_id: 'linea-1', orden: 8, nombre: 'Cierre', config_extra: { gates: gatesE8 } },
      { id: E9, linea_id: 'linea-1', orden: 9, nombre: 'Postventa', config_extra: {} },
    ],
    negocio_bloques: [],
    cotizaciones: [],
    cobros: [],
  }
}

const nombres = (r: { bloquesPendientes?: Array<{ nombre: string }> }) => (r.bloquesPendientes ?? []).map((b) => b.nombre)

beforeEach(() => sembrar(['saldo_cero', 'margen_confirmado']))

describe('los gates de la etapa salen en un solo aviso', () => {
  it('E8 con saldo pendiente y sin cierre confirmado muestra las dos líneas, en el orden de siempre', async () => {
    const r = await cambiarEtapaNegocioConGate(NEG, E9)
    expect(r.error).toBe('gate_bloqueado')
    expect(nombres(r)).toEqual([mensajeSaldoCero(SALDO_PENDIENTE), FALTA_CIERRE])
    expect(moverEtapa).not.toHaveBeenCalled()
  })

  it('al saldar queda solo la del cierre', async () => {
    lecturaSaldo = { ok: true, saldo: SALDO_CUBIERTO }
    const r = await cambiarEtapaNegocioConGate(NEG, E9)
    expect(nombres(r)).toEqual([FALTA_CIERRE])
  })

  it('una lectura que falla sigue frenando, junto con lo demás', async () => {
    lecturaSaldo = { ok: false, error: 'No se pudo leer el saldo' }
    const r = await cambiarEtapaNegocioConGate(NEG, E9)
    expect(r.error).toBe('gate_bloqueado')
    expect(nombres(r)).toEqual(['No se pudo leer el saldo', FALTA_CIERRE])
  })

  it('el override con motivo sigue saltando todas esas familias', async () => {
    const r = await cambiarEtapaNegocioConGate(NEG, E9, 'el cliente pagó en efectivo, ya lo confirmé')
    expect(r.error).toBeNull()
    expect(r.bloquesPendientes).toBeUndefined()
    expect(moverEtapa).toHaveBeenCalled()
  })

  it('cotizacion_requerida se suma a las demás líneas cuando la etapa lo declara', async () => {
    sembrar(['cotizacion_requerida', 'saldo_cero'])
    const r = await cambiarEtapaNegocioConGate(NEG, E9)
    expect(nombres(r)[0]).toBe(MENSAJE_GATE_COTIZACION_REQUERIDA)
    expect(nombres(r)).toHaveLength(2)
  })
})
