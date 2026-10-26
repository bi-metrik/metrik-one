/**
 * `avanzarCrucesConMotivo`: el servidor decide quién avanza un cruce, no la pantalla.
 *
 * - quien no está en `avanzar_cruces.staff_ids` recibe error y no se escribe nada, aunque
 *   llame la acción directo (sin botón);
 * - un motivo que no es una frase se rechaza;
 * - el autorizado deja UNA excepción por cruce que frena HOY, con la huella que calcula el
 *   servidor (no la que mande el cliente), y la entrada del historial con el motivo;
 * - un slug que hoy no frena, o un voto en disputa, no deja nada.
 *
 * Datos inventados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>

let configWs: Fila | null = null
let tablas: Record<string, Fila[]> = {}
let inserts: Array<{ tabla: string; payload: unknown }> = []
let bloqueantes: Array<Record<string, unknown>> = []
let puedeAvanzarFase = true

const registrarActividad = vi.fn(async (..._args: unknown[]) => ({ ok: true, id: 'a-1' }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(),
    workspaceId: 'ws-1',
    userId: 'p-1',
    role: 'supervisor',
    staffId: 'staff-1',
    error: null,
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => clienteFalso(),
  createClient: async () => clienteFalso(),
}))

vi.mock('@/lib/permissions/guard-negocio', () => ({
  guardEditarBloque: async () => ({ ok: true }),
  guardVerNegocio: async () => ({ ok: true }),
  guardAvanzarStage: async () => (puedeAvanzarFase ? { ok: true } : { ok: false, error: 'Sin permiso de fase' }),
}))

vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: (...args: unknown[]) => registrarActividad(...args),
}))

vi.mock('@/lib/actions/conciliacion-actions', () => ({
  leerModeloDineroCompleto: async () => null,
  leerModeloDineroNegocio: async () => null,
  crearCobrosSoenaCore: async () => ({ error: null }),
}))

vi.mock('@/lib/negocios/datos-clave-servidor', () => ({
  datosClaveDelNegocio: async () => null,
  contradiccionesQueBloquean: async () => bloqueantes,
}))

function clienteFalso() {
  return { from: (tabla: string) => constructor(tabla) }
}

function constructor(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let payload: unknown = null
  const filas = () => {
    if (tabla === 'workspaces') return [{ id: 'ws-1', config_extra: configWs }]
    return (tablas[tabla] ?? []).filter(f => filtros.every(p => p(f)))
  }
  const api = {
    select: () => api,
    eq(col: string, val: unknown) {
      filtros.push(f => f[col] === val)
      return api
    },
    insert(p: unknown) {
      payload = p
      inserts.push({ tabla, payload })
      return Promise.resolve({ data: null, error: null })
    },
    maybeSingle: () => Promise.resolve({ data: filas()[0] ?? null, error: null }),
    single: () => Promise.resolve({ data: filas()[0] ?? null, error: null }),
  }
  return api
}

import { avanzarCrucesConMotivo } from './negocio-v2-actions'

const MOTIVO = 'El proveedor confirmó por escrito que el valor es correcto.'

beforeEach(() => {
  configWs = { avanzar_cruces: { staff_ids: ['staff-1'] } }
  puedeAvanzarFase = true
  inserts = []
  registrarActividad.mockClear()
  tablas = {
    negocios: [{ id: 'neg-1', workspace_id: 'ws-1', etapa_actual_id: 'et-9', stage_actual: 'ejecucion' }],
    etapas_negocio: [{ id: 'et-9', orden: 9, linea_id: 'lin-1', nombre: 'Certificación', config_extra: {} }],
    lineas_negocio: [{ id: 'lin-1', config_extra: { cruces: [] } }],
  }
  bloqueantes = [
    { slug: 'certificado_valor_vs_factura', mensaje: 'El valor no coincide', bloquea: true, huella: 'h-servidor' },
    { slug: 'voto:documento_titular', mensaje: 'Las lecturas no coinciden', bloquea: true },
  ]
})

describe('avanzarCrucesConMotivo', () => {
  it('quien no está en la lista recibe error y no se escribe nada', async () => {
    configWs = { avanzar_cruces: { staff_ids: ['otra-persona'] }, omitir_gate: { staff_ids: ['staff-1'] } }
    const r = await avanzarCrucesConMotivo('neg-1', ['certificado_valor_vs_factura'], MOTIVO)
    expect(r.error).toMatch(/permiso/)
    expect(inserts).toEqual([])
    expect(registrarActividad).not.toHaveBeenCalled()
  })

  it('sin la lista en el workspace, nadie', async () => {
    configWs = null
    const r = await avanzarCrucesConMotivo('neg-1', ['certificado_valor_vs_factura'], MOTIVO)
    expect(r.error).toMatch(/permiso/)
    expect(inserts).toEqual([])
  })

  it('un motivo que no es una frase se rechaza', async () => {
    const r = await avanzarCrucesConMotivo('neg-1', ['certificado_valor_vs_factura'], 'ok')
    expect(r.error).toMatch(/motivo/)
    expect(inserts).toEqual([])
  })

  it('sin permiso para avanzar la fase, tampoco', async () => {
    puedeAvanzarFase = false
    const r = await avanzarCrucesConMotivo('neg-1', ['certificado_valor_vs_factura'], MOTIVO)
    expect(r.error).toBe('Sin permiso de fase')
    expect(inserts).toEqual([])
  })

  it('el autorizado deja la excepción con la huella del servidor y la entrada del historial', async () => {
    const r = await avanzarCrucesConMotivo(
      'neg-1',
      ['certificado_valor_vs_factura', 'voto:documento_titular', 'cruce_que_hoy_no_frena'],
      `  ${MOTIVO}  `,
    )
    expect(r).toEqual({ error: null, avanzados: 1 })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].tabla).toBe('negocio_cruces_avanzados')
    expect(inserts[0].payload).toEqual([{
      workspace_id: 'ws-1',
      negocio_id: 'neg-1',
      cruce_slug: 'certificado_valor_vs_factura',
      huella: 'h-servidor',
      mensaje: 'El valor no coincide',
      motivo: MOTIVO,
      etapa_id: 'et-9',
      autor_id: 'staff-1',
    }])
    expect(registrarActividad).toHaveBeenCalledTimes(1)
    const fila = registrarActividad.mock.calls[0][1] as Fila
    expect(fila).toMatchObject({
      entidad_tipo: 'negocio',
      entidad_id: 'neg-1',
      tipo: 'cambio',
      autor_id: 'staff-1',
      campo_modificado: 'cruce_avanzado',
      valor_nuevo: 'certificado_valor_vs_factura',
      contenido: MOTIVO,
    })
  })

  it('si el cruce ya no frena (se corrigió el dato), no deja nada', async () => {
    bloqueantes = []
    const r = await avanzarCrucesConMotivo('neg-1', ['certificado_valor_vs_factura'], MOTIVO)
    expect(r).toEqual({ error: null, avanzados: 0 })
    expect(inserts).toEqual([])
  })

  it('un negocio de otro workspace no se encuentra', async () => {
    tablas.negocios[0].workspace_id = 'ws-otro'
    const r = await avanzarCrucesConMotivo('neg-1', ['certificado_valor_vs_factura'], MOTIVO)
    expect(r.error).toBe('Negocio no encontrado')
    expect(inserts).toEqual([])
  })
})
