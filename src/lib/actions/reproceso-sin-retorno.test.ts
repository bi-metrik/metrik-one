/**
 * Reproceso: a dónde vuelve el caso (3B) y el error que se registra sin devolverlo (3C).
 *
 * Lo que se fija aquí, sobre las server actions reales con la base doblada:
 * - un caso antes del punto de retorno NO se reprocesa, y la respuesta trae
 *   `antesDelRetorno` para que la pantalla ofrezca registrar el error;
 * - `registrarErrorSinDevolver` inserta UN evento con el cliente de SERVICIO (con el de la
 *   sesión muere en 42501, PR #440), nacido cerrado y con `ciclo = CICLO_SIN_RETORNO`;
 * - y NO toca el negocio ni sus bloques, por ninguno de los dos clientes;
 * - si el insert falla, lo dice (es todo el efecto de la acción);
 * - la misma puerta que el reproceso: un operador no registra nada;
 * - cuando el retorno resuelto no es el declarado, el caso va al resuelto, la marca lo
 *   nombra y el resultado trae el aviso.
 *
 * EL DOBLE APLICA LOS FILTROS (`eq`, `in` con rutas embebidas) y separa las escrituras por
 * cliente: una escritura con el cliente de la sesión y otra con el de servicio no son lo
 * mismo, y confundirlas es exactamente el defecto del #440.
 *
 * Mutaciones sobre `reproceso-actions.ts` medidas el 2026-09-14, cada una tumba 1 prueba:
 * evento nacido abierto, insert con el cliente de la sesión, `ciclo: 1` en vez de la marca,
 * ignorar el retorno resuelto, quitar `antesDelRetorno`, tragarse el error del insert, y
 * registrar sin pasar por la puerta de permisos.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CICLO_SIN_RETORNO } from '@/lib/negocios/atribucion-reproceso'

type Fila = Record<string, unknown>
type Escritura = { cliente: 'sesion' | 'servicio'; tabla: string; op: 'insert' | 'update'; payload: Fila }

let tablas: Record<string, Fila[]> = {}
let escrituras: Escritura[] = []
let sesion = { role: 'owner', staffId: 'staff-deisy' as string | null }
let falloInsertEvento = false
let retornoResuelto: { orden: number; motivo: string; rama: null } | null = null

const registrarActividad = vi.fn(async (..._args: unknown[]) => ({ ok: true, id: null }))
const resolverAtribucion = vi.fn(async (..._args: unknown[]) => 'staff-maria')

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: cliente('sesion'),
    workspaceId: 'ws-soena',
    userId: 'prof-deisy',
    role: sesion.role,
    staffId: sesion.staffId,
    error: null,
  }),
}))
vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: cliente('sesion'),
    workspaceId: 'ws-soena',
    userId: 'prof-deisy',
    role: sesion.role,
    staffId: sesion.staffId,
    error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente('servicio') }))
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: (...a: unknown[]) => registrarActividad(...a),
}))
vi.mock('@/lib/negocios/atribucion-reproceso', async (original) => ({
  ...(await original<typeof import('@/lib/negocios/atribucion-reproceso')>()),
  resolverAtribucionReproceso: (...a: unknown[]) => resolverAtribucion(...a),
}))
vi.mock('@/lib/negocios/retorno-reproceso-datos', () => ({
  resolverRetornoDelNegocio: async (_s: unknown, p: { destinoOrden: number }) =>
    retornoResuelto ?? { orden: p.destinoOrden, motivo: 'aplica', rama: null },
}))

function leer(fila: Fila, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Fila)[k] : undefined), fila)
}

function cliente(nombre: 'sesion' | 'servicio') {
  return {
    from: (tabla: string) => constructor(nombre, tabla),
    rpc: async () => ({ data: null, error: null }),
  }
}

function constructor(nombre: 'sesion' | 'servicio', tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let operacion: 'select' | 'update' | 'insert' = 'select'
  let payload: Fila = {}

  const ejecutar = (): { data: Fila[]; error: { message: string } | null } => {
    if (operacion === 'insert') {
      if (tabla === 'reproceso_eventos' && falloInsertEvento) return { data: [], error: { message: 'boom' } }
      escrituras.push({ cliente: nombre, tabla, op: 'insert', payload })
      return { data: [payload], error: null }
    }
    const filas = (tablas[tabla] ?? []).filter((f) => filtros.every((p) => p(f)))
    if (operacion === 'update') {
      escrituras.push({ cliente: nombre, tabla, op: 'update', payload })
      return { data: filas, error: null }
    }
    return { data: filas.map((f) => structuredClone(f)), error: null }
  }

  const api = {
    select: () => api,
    update: (p: Fila) => { operacion = 'update'; payload = p; return api },
    insert: (p: Fila) => { operacion = 'insert'; payload = p; return api },
    eq: (ruta: string, v: unknown) => { filtros.push((f) => leer(f, ruta) === v); return api },
    in: (ruta: string, vs: unknown[]) => { filtros.push((f) => vs.includes(leer(f, ruta))); return api },
    is: () => api,
    order: () => api,
    limit: () => api,
    single: async () => { const r = ejecutar(); return { data: r.data[0] ?? null, error: r.error } },
    maybeSingle: async () => { const r = ejecutar(); return { data: r.data[0] ?? null, error: r.error } },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then: (res: (v: any) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(ejecutar()).then(res, rej),
  }
  return api
}

const { reprocesarNegocio, registrarErrorSinDevolver } = await import('./reproceso-actions')

const LINEA = 'linea-ve'
const etapa = (orden: number, nombre: string, config_extra: Fila = {}) => ({
  id: `etapa-${orden}`, linea_id: LINEA, orden, nombre, config_extra,
})

function sembrar(etapaActualOrden: number) {
  tablas = {
    negocios: [{
      id: 'neg-v0388', workspace_id: 'ws-soena', estado: 'abierto', stage_actual: 'ejecucion',
      etapa_actual_id: `etapa-${etapaActualOrden}`, linea_id: LINEA, metadata: { seccional: 'Bogotá' },
      codigo: 'V0388', nombre: 'Caso',
    }],
    etapas_negocio: [
      etapa(12, 'Entrega'),
      etapa(13, 'Generación'),
      etapa(14, 'Envío'),
      etapa(16, 'Cita', { reproceso_de: ['devolucion_dian'] }),
      etapa(17, 'Notificación'),
      etapa(18, 'Anexos'),
      etapa(19, 'Seguimiento'),
    ],
    negocio_bloques: [
      { id: 'b-anexos', negocio_id: 'neg-v0388', data: { x: 1 }, estado: 'completo', bloque_configs: { etapa_id: 'etapa-18', config_extra: {} } },
      { id: 'b-seg', negocio_id: 'neg-v0388', data: { y: 2 }, estado: 'completo', bloque_configs: { etapa_id: 'etapa-19', config_extra: {} } },
    ],
    staff: [{ id: 'staff-deisy', full_name: 'Deisy Ramirez' }],
    staff_areas: [{ staff_id: 'staff-deisy', area: 'operaciones' }],
    profiles: [],
  }
}

const input = { tipo: 'devolucion_dian' as const, causa: 'error_propio' as const, detalle: 'No se envió la documentación antes de la cita.' }
const tocoElCaso = () => escrituras.some((e) => e.tabla === 'negocios' || e.tabla === 'negocio_bloques')

beforeEach(() => {
  escrituras = []
  sesion = { role: 'owner', staffId: 'staff-deisy' }
  falloInsertEvento = false
  retornoResuelto = null
  registrarActividad.mockClear()
  resolverAtribucion.mockClear()
})

describe('reprocesarNegocio — antes del punto de retorno', () => {
  it('V0388 en Envío: no reprocesa, no escribe, y ofrece registrar el error', async () => {
    sembrar(14)
    const r = await reprocesarNegocio('neg-v0388', input)
    expect(r.ok).toBe(false)
    expect(r.antesDelRetorno).toEqual({ etapaActual: 'Envío', etapaRetorno: 'Cita' })
    expect(escrituras).toEqual([])
  })
})

describe('registrarErrorSinDevolver', () => {
  it('inserta un evento con el cliente de servicio, cerrado al nacer y con el ciclo de marca', async () => {
    sembrar(14)
    const r = await registrarErrorSinDevolver('neg-v0388', input)
    expect(r).toEqual({ ok: true })
    const eventos = escrituras.filter((e) => e.tabla === 'reproceso_eventos')
    expect(eventos).toHaveLength(1)
    expect(eventos[0].cliente).toBe('servicio')
    expect(eventos[0].payload).toMatchObject({
      workspace_id: 'ws-soena',
      negocio_id: 'neg-v0388',
      ciclo: CICLO_SIN_RETORNO,
      tipo: 'devolucion_dian',
      causa: 'error_propio',
      detalle: input.detalle,
      atribuido_a: 'staff-maria',
      abierto_por: 'staff-deisy',
    })
    expect(eventos[0].payload.cerrado_at).toBe(eventos[0].payload.abierto_at)
  })

  it('no mueve el caso ni archiva bloques', async () => {
    sembrar(14)
    await registrarErrorSinDevolver('neg-v0388', input)
    expect(tocoElCaso()).toBe(false)
  })

  it('atribuye con el mismo resolvedor, acotado al workspace y a lo generado antes', async () => {
    sembrar(14)
    await registrarErrorSinDevolver('neg-v0388', input)
    const [, negocioId, tipo, opciones] = resolverAtribucion.mock.calls[0] as [unknown, string, string, { workspaceId: string; antesDe: string }]
    expect([negocioId, tipo, opciones.workspaceId]).toEqual(['neg-v0388', 'devolucion_dian', 'ws-soena'])
    expect(typeof opciones.antesDe).toBe('string')
  })

  it('deja la línea en el timeline diciendo dónde sigue el caso', async () => {
    sembrar(14)
    await registrarErrorSinDevolver('neg-v0388', input)
    const fila = registrarActividad.mock.calls[0][1] as { tipo: string; contenido: string }
    expect(fila.tipo).toBe('sistema')
    expect(fila.contenido).toContain('El caso sigue en Envío.')
  })

  it('si el insert falla, lo dice y no deja rastro en el timeline', async () => {
    sembrar(14)
    falloInsertEvento = true
    const r = await registrarErrorSinDevolver('neg-v0388', input)
    expect(r.ok).toBe(false)
    expect(registrarActividad).not.toHaveBeenCalled()
  })

  it('un operador no registra nada', async () => {
    sembrar(14)
    sesion = { role: 'operator', staffId: 'staff-deisy' }
    const r = await registrarErrorSinDevolver('neg-v0388', input)
    expect(r.ok).toBe(false)
    expect(escrituras).toEqual([])
  })

  it('sin detalle no registra', async () => {
    sembrar(14)
    const r = await registrarErrorSinDevolver('neg-v0388', { ...input, detalle: '   ' })
    expect(r.ok).toBe(false)
    expect(escrituras).toEqual([])
  })
})

describe('reprocesarNegocio — retorno a la etapa que sí aplica', () => {
  it('desde Seguimiento, un caso sin cita vuelve a Anexos: se mueve ahí, la marca lo nombra y avisa', async () => {
    sembrar(19)
    retornoResuelto = { orden: 18, motivo: 'no_aplica', rama: null }
    const r = await reprocesarNegocio('neg-v0388', input)
    expect(r).toMatchObject({ ok: true, etapaNombre: 'Anexos', ciclo: 1 })
    expect(r.aviso).toContain('no pasa por Cita')

    const mov = escrituras.find((e) => e.tabla === 'negocios' && e.op === 'update')
    expect(mov?.payload.etapa_actual_id).toBe('etapa-18')
    expect((mov?.payload.metadata as { reproceso: { etapa_retorno: string } }).reproceso.etapa_retorno).toBe('Anexos')

    const evento = escrituras.find((e) => e.tabla === 'reproceso_eventos')
    expect(evento?.cliente).toBe('servicio')
    expect(evento?.payload.ciclo).toBe(1)
  })

  it('retorno declarado: sin aviso', async () => {
    sembrar(19)
    const r = await reprocesarNegocio('neg-v0388', input)
    expect(r).toMatchObject({ ok: true, etapaNombre: 'Cita' })
    expect(r.aviso).toBeUndefined()
  })
})
