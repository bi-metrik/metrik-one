/**
 * `marcarBloqueCompleto` mira el TIPO del bloque antes de escribir `completo`.
 *
 * El hueco: validaba el permiso de edición y escribía `estado='completo'` sobre cualquier
 * bloque, sin mirar su tipo. Una server action exportada es un endpoint alcanzable, así
 * que con el id bastaba para dar por completo un cronograma sin fechas, un checklist sin
 * marcar, un bloque de cobros con saldo o una propuesta sin aprobar.
 *
 * Lo que se fija aquí:
 * - un tipo de completitud derivada con el criterio incumplido rechaza y NO escribe;
 * - con el criterio cumplido escribe;
 * - el criterio se evalúa sobre lo GUARDADO: lo que manda el navegador no cuenta;
 * - los tipos que se cierran con su propia acción se rechazan;
 * - los manuales (`datos`, el multi-pago, el sello) escriben como antes;
 * - el guard de edición sigue cortando primero.
 *
 * EL DOBLE APLICA LOS FILTROS `.eq()`: los ítems de otro bloque no cuentan para este.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let escrituras: Array<{ tabla: string; op: 'insert' | 'update'; payload: Fila }> = []
let puedeEditar = true
let tarifaUpme = 0

const guardEditarBloque = vi.fn(async (_negocioBloqueId: string) =>
  puedeEditar ? { ok: true } : { ok: false, error: 'Tu rol o área no permite editar en esta fase del negocio' },
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
  guardVerNegocio: async () => ({ ok: true }),
  guardAvanzarStage: async () => ({ ok: true }),
}))

vi.mock('@/lib/negocios/casilla-compartida', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/negocios/casilla-compartida')>()),
  resolverDestinoCompartido: async (_s: unknown, id: string) => id,
}))

vi.mock('@/lib/correcciones/registrar', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/correcciones/registrar')>()),
  contextoCorreccion: async () => null,
}))

vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async () => ({ error: null }),
}))

// El modelo de dinero del negocio: solo importa la tarifa pasante, que es lo que separa
// el criterio del bloque de cobros de comparar contra el honorario pelado.
vi.mock('@/lib/actions/conciliacion-actions', () => ({
  leerModeloDineroCompleto: async () => (tarifaUpme > 0 ? { tarifa_upme: tarifaUpme } : null),
  leerModeloDineroNegocio: async () => null,
  crearCobrosSoenaCore: async () => ({ error: null }),
}))

function clienteFalso() {
  return { from: (tabla: string) => constructor(tabla) }
}

function constructor(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let operacion: 'select' | 'update' | 'insert' = 'select'
  let payload: Fila = {}

  const ejecutar = (): Fila[] => {
    if (operacion === 'insert') {
      escrituras.push({ tabla, op: 'insert', payload })
      return [payload]
    }
    const filas = (tablas[tabla] ?? []).filter(f => filtros.every(p => p(f)))
    if (operacion === 'update') {
      for (const f of filas) Object.assign(f, payload)
      escrituras.push({ tabla, op: 'update', payload })
      return filas
    }
    return filas.map(f => structuredClone(f))
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
    insert(p: Fila) {
      operacion = 'insert'
      payload = p
      return api
    },
    eq(col: string, val: unknown) {
      filtros.push(f => f[col] === val)
      return api
    },
    in(col: string, vals: unknown[]) {
      filtros.push(f => vals.includes(f[col]))
      return api
    },
    order() {
      return api
    },
    limit() {
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

import { marcarBloqueCompleto } from './negocio-v2-actions'
import { MENSAJE_ACCION_PROPIA, MENSAJE_SALDO_POR_COBRAR } from '@/lib/negocios/cierre-bloque'

const NEGOCIO = 'neg-1'

function bloque(id: string, tipo: string, configExtra: Fila = {}, data: Fila = {}, esGate = false): Fila {
  return {
    id,
    negocio_id: NEGOCIO,
    estado: 'pendiente',
    data,
    bloque_configs: {
      es_gate: esGate,
      slug: null,
      nombre: `Bloque ${id}`,
      config_extra: configExtra,
      bloque_definitions: { tipo, nombre: tipo },
    },
  }
}

const filaDe = (id: string) => tablas.negocio_bloques.find(b => b.id === id) as Fila
const escribioEnBloques = () => escrituras.some(e => e.tabla === 'negocio_bloques')

function item(bloqueId: string, extra: Fila): Fila {
  return { id: `it-${Math.random().toString(36).slice(2)}`, negocio_bloque_id: bloqueId, ...extra }
}

beforeEach(() => {
  puedeEditar = true
  tarifaUpme = 0
  escrituras = []
  guardEditarBloque.mockClear()
  tablas = {
    negocio_bloques: [],
    bloque_items: [],
    negocios: [{ id: NEGOCIO, precio_aprobado: 850_000, precio_estimado: null }],
    cobros: [],
  }
})

describe('cronograma', () => {
  it('con la regla de fechas y una actividad sin fin: rechaza y no escribe', async () => {
    tablas.negocio_bloques.push(bloque('nb-cron', 'cronograma', { require_all_dates: true }))
    tablas.bloque_items.push(item('nb-cron', { fecha_inicio: '2026-09-20', fecha_fin: null }))

    const r = await marcarBloqueCompleto('nb-cron', {})

    expect(r.error).toBe('Falta la fecha planeada de 1 actividad')
    expect(filaDe('nb-cron').estado).toBe('pendiente')
    expect(escribioEnBloques()).toBe(false)
  })

  it('sin actividades: rechaza aunque no exija fechas', async () => {
    tablas.negocio_bloques.push(bloque('nb-cron', 'cronograma'))
    // Una actividad de OTRO bloque no cuenta.
    tablas.bloque_items.push(item('nb-otro', { fecha_inicio: '2026-09-20', fecha_fin: '2026-09-25' }))

    const r = await marcarBloqueCompleto('nb-cron', {})

    expect(r.error).toBe('El cronograma no tiene actividades')
    expect(escribioEnBloques()).toBe(false)
  })

  it('con todas las fechas: escribe completo', async () => {
    tablas.negocio_bloques.push(bloque('nb-cron', 'cronograma', { require_all_dates: true }))
    tablas.bloque_items.push(item('nb-cron', { fecha_inicio: '2026-09-20', fecha_fin: '2026-09-25' }))

    const r = await marcarBloqueCompleto('nb-cron', {})

    expect(r.error).toBeNull()
    expect(filaDe('nb-cron').estado).toBe('completo')
  })
})

describe('checklist', () => {
  it('con un ítem sin marcar: rechaza y no escribe, aunque el navegador diga que viene del checklist', async () => {
    tablas.negocio_bloques.push(bloque('nb-chk', 'checklist'))
    tablas.bloque_items.push(
      item('nb-chk', { completado: true }),
      item('nb-chk', { completado: false }),
    )

    const r = await marcarBloqueCompleto('nb-chk', { completado_via: 'checklist' })

    expect(r.error).toBe('Falta 1 ítem por marcar')
    expect(filaDe('nb-chk').estado).toBe('pendiente')
    expect(escribioEnBloques()).toBe(false)
  })

  it('con todos marcados: escribe completo', async () => {
    tablas.negocio_bloques.push(bloque('nb-chk', 'checklist'))
    tablas.bloque_items.push(item('nb-chk', { completado: true }), item('nb-chk', { completado: true }))

    const r = await marcarBloqueCompleto('nb-chk', { completado_via: 'checklist' })

    expect(r.error).toBeNull()
    expect(filaDe('nb-chk').estado).toBe('completo')
  })

  it('checklist con soporte: marcado sin enlace no alcanza', async () => {
    tablas.negocio_bloques.push(bloque('nb-sop', 'checklist_soporte'))
    tablas.bloque_items.push(item('nb-sop', { completado: true, link_url: null }))

    const r = await marcarBloqueCompleto('nb-sop', { completado_via: 'checklist' })

    expect(r.error).toBe('Falta 1 ítem con su soporte')
    expect(escribioEnBloques()).toBe(false)
  })

  it('un checklist con withSupport en la config también exige el enlace', async () => {
    tablas.negocio_bloques.push(bloque('nb-chk', 'checklist', { withSupport: true }))
    tablas.bloque_items.push(item('nb-chk', { completado: true, link_url: '' }))

    const r = await marcarBloqueCompleto('nb-chk', {})

    expect(r.error).toBe('Falta 1 ítem con su soporte')
    expect(escribioEnBloques()).toBe(false)
  })
})

describe('documentos', () => {
  const config = {
    documentos: [
      { slug: 'rut', label: 'RUT', required: true },
      { slug: 'extra', label: 'Anexo', required: false },
    ],
  }

  it('un documento obligatorio sin subir: rechaza, aunque el navegador mande el enlace', async () => {
    tablas.negocio_bloques.push(bloque('nb-docs', 'documentos', config, { docs: {} }))

    const r = await marcarBloqueCompleto('nb-docs', { docs: { rut: 'https://inventado/rut.pdf' } })

    expect(r.error).toBe('Faltan documentos obligatorios: RUT')
    expect(filaDe('nb-docs').estado).toBe('pendiente')
    expect(filaDe('nb-docs').data).toEqual({ docs: {} })
    expect(escribioEnBloques()).toBe(false)
  })

  it('con los obligatorios guardados: escribe completo', async () => {
    tablas.negocio_bloques.push(bloque('nb-docs', 'documentos', config, { docs: { rut: 'https://storage/rut.pdf' } }))

    const r = await marcarBloqueCompleto('nb-docs', {})

    expect(r.error).toBeNull()
    expect(filaDe('nb-docs').estado).toBe('completo')
  })
})

describe('equipo', () => {
  it('sin responsable asignado: rechaza y no escribe', async () => {
    tablas.negocio_bloques.push(bloque('nb-eq', 'equipo'))

    const r = await marcarBloqueCompleto('nb-eq', { comercial_id: null, ejecucion_id: null, financiero_id: null })

    expect(r.error).toBe('Asigna al responsable antes de dar el bloque por completo')
    expect(escribioEnBloques()).toBe(false)
  })

  it('con el rol de la config: asignar otro rol no alcanza', async () => {
    tablas.negocio_bloques.push(bloque('nb-eq', 'equipo', { rol: 'financiero' }))

    const r = await marcarBloqueCompleto('nb-eq', { comercial_id: 'p-1', financiero_id: null })

    expect(r.error).not.toBeNull()
    expect(escribioEnBloques()).toBe(false)
  })

  it('con el responsable asignado: escribe completo y guarda la asignación', async () => {
    tablas.negocio_bloques.push(bloque('nb-eq', 'equipo', { rol: 'financiero' }))

    const r = await marcarBloqueCompleto('nb-eq', { financiero_id: 'p-1' })

    expect(r.error).toBeNull()
    expect(filaDe('nb-eq').estado).toBe('completo')
    expect((filaDe('nb-eq').data as Fila).financiero_id).toBe('p-1')
  })
})

describe('cobros', () => {
  it('con el honorario pagado pero la tarifa pasante sin pagar: rechaza (el mismo criterio del evaluador)', async () => {
    tarifaUpme = 350_000
    tablas.negocio_bloques.push(bloque('nb-cob', 'cobros'))
    tablas.cobros.push({ negocio_id: NEGOCIO, monto: 850_000, fecha: '2026-09-01' })

    const r = await marcarBloqueCompleto('nb-cob', {})

    expect(r.error).toBe(MENSAJE_SALDO_POR_COBRAR)
    expect(filaDe('nb-cob').estado).toBe('pendiente')
    expect(escribioEnBloques()).toBe(false)
  })

  it('un cobro sin fecha no cuenta como recaudado', async () => {
    tablas.negocio_bloques.push(bloque('nb-cob', 'cobros'))
    tablas.cobros.push({ negocio_id: NEGOCIO, monto: 850_000, fecha: null })

    const r = await marcarBloqueCompleto('nb-cob', {})

    expect(r.error).toBe(MENSAJE_SALDO_POR_COBRAR)
    expect(escribioEnBloques()).toBe(false)
  })

  it('con el valor a recaudar cubierto: escribe completo', async () => {
    tarifaUpme = 350_000
    tablas.negocio_bloques.push(bloque('nb-cob', 'cobros'))
    tablas.cobros.push({ negocio_id: NEGOCIO, monto: 1_200_000, fecha: '2026-09-01' })

    const r = await marcarBloqueCompleto('nb-cob', {})

    expect(r.error).toBeNull()
    expect(filaDe('nb-cob').estado).toBe('completo')
  })
})

describe('tipos que se cierran con su propia acción', () => {
  it('una propuesta económica no se aprueba marcándola completa: rechaza y no mezcla lo que llega', async () => {
    tablas.negocio_bloques.push(bloque('nb-prop', 'propuesta_economica', {}, { versiones: [] }))

    const r = await marcarBloqueCompleto('nb-prop', { aprobado_at: '2026-09-14T10:00:00Z', aprobado_honorario: 1 })

    expect(r.error).toBe(MENSAJE_ACCION_PROPIA)
    expect(filaDe('nb-prop').estado).toBe('pendiente')
    expect(filaDe('nb-prop').data).toEqual({ versiones: [] })
    expect(escribioEnBloques()).toBe(false)
  })

  it('una superficie de pago por ePayco no se cierra sin registrar el pago', async () => {
    tablas.negocio_bloques.push(bloque('nb-epayco', 'datos', { es_pagos_epayco: true }, {}, true))

    const r = await marcarBloqueCompleto('nb-epayco', { pagos: [{ referencia_epayco: 'x', valor_pago: 1 }] })

    expect(r.error).toBe(MENSAJE_ACCION_PROPIA)
    expect(escribioEnBloques()).toBe(false)
  })
})

describe('tipos manuales: escriben como antes', () => {
  it('datos que no es gate', async () => {
    tablas.negocio_bloques.push(bloque('nb-datos', 'datos', { fields: [{ slug: 'nota', required: true }] }))

    const r = await marcarBloqueCompleto('nb-datos', { nota: '' })

    expect(r.error).toBeNull()
    expect(filaDe('nb-datos').estado).toBe('completo')
  })

  it('el multi-pago', async () => {
    tablas.negocio_bloques.push(bloque('nb-multi', 'datos', { es_multi_pago: true }))

    const r = await marcarBloqueCompleto('nb-multi', { pagos: [] })

    expect(r.error).toBeNull()
    expect(filaDe('nb-multi').estado).toBe('completo')
  })

  it('el sello de completado', async () => {
    tablas.negocio_bloques.push(bloque('nb-sello', 'datos', { completion_stamp: true }))

    const r = await marcarBloqueCompleto('nb-sello', {})

    expect(r.error).toBeNull()
    expect(filaDe('nb-sello').estado).toBe('completo')
  })

  it('un tipo que la clasificación no conoce', async () => {
    tablas.negocio_bloques.push(bloque('nb-nuevo', 'tipo_nuevo'))

    const r = await marcarBloqueCompleto('nb-nuevo', {})

    expect(r.error).toBeNull()
    expect(filaDe('nb-nuevo').estado).toBe('completo')
  })
})

describe('el guard de edición sigue primero', () => {
  it('sin permiso no se escribe, aunque el criterio se cumpla', async () => {
    puedeEditar = false
    tablas.negocio_bloques.push(bloque('nb-chk', 'checklist'))
    tablas.bloque_items.push(item('nb-chk', { completado: true }))

    const r = await marcarBloqueCompleto('nb-chk', {})

    expect(r.error).toBe('Tu rol o área no permite editar en esta fase del negocio')
    expect(guardEditarBloque).toHaveBeenCalledWith('nb-chk')
    expect(filaDe('nb-chk').estado).toBe('pendiente')
    expect(escribioEnBloques()).toBe(false)
  })
})
