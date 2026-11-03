/**
 * El aviso «Falta la autorización de datos» no puede desaparecer al pasar a Cotización (prueba con
 * clics en el espacio de una agencia, 2026-10-25). El bloque «Autorización de datos» vive en
 * Solicitud y su trabajo no queda en `negocio_bloques.data` (vive en el contacto), así que el
 * historial de etapas previas lo salta mientras falta la firma. La bandera salía de ese historial
 * y en Cotización quedaba siempre en `false`: el usuario se enteraba en el último clic.
 *
 * Ahora sale de la MISMA regla que frena «Enviar» (`autorizacion-datos/envio.ts`). Se llama a la
 * lectura real de la ficha (`getNegocioDetalleCompleto`) sobre tablas en memoria. Datos ficticios.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: () => {}, unstable_cache: (f: unknown) => f }))

type Fila = Record<string, unknown>
const t = vi.hoisted(() => ({
  tablas: {} as Record<string, Record<string, unknown>[]>,
  autorizacion: { generales: false, menores: false, existe: true },
  rpcContacto: 0,
}))

function leer(f: Fila, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Fila)[k] : undefined), f)
}

/** Doble que aplica `eq`/`in`/`is` y deja pasar lo demás; escribe en `update`. */
function cliente() {
  const from = (tabla: string) => {
    const filtros: Array<(f: Fila) => boolean> = []
    let patch: Fila | null = null
    const filas = () => (t.tablas[tabla] ?? []).filter(f => filtros.every(p => p(f)))
    const correr = () => {
      const fs = filas()
      if (patch) for (const f of fs) Object.assign(f, patch)
      return { data: fs.map(f => ({ ...f })), error: null, count: fs.length }
    }
    const metodos: Record<string, unknown> = {}
    // Cualquier filtro que el doble no conoce (`like`, `order`, `range`…) encadena sin recortar.
    const q: Record<string, unknown> = new Proxy(metodos, { get: (o, k: string) => (k in o ? o[k] : () => q) })
    const encadenar = () => q
    Object.assign(metodos, {
      eq: (c: string, v: unknown) => { filtros.push(f => leer(f, c) === v); return q },
      in: (c: string, vs: unknown[]) => { filtros.push(f => vs.includes(leer(f, c))); return q },
      is: (c: string, v: unknown) => { filtros.push(f => (leer(f, c) ?? null) === v); return q },
      update: (p: Fila) => { patch = p; return q },
      insert: () => ({ ...q, then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r) }),
      upsert: () => ({ ...q, then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(r) }),
      delete: encadenar,
      single: async () => ({ data: correr().data[0] ?? null, error: null }),
      maybeSingle: async () => ({ data: correr().data[0] ?? null, error: null }),
      then: (r: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(correr()).then(r, rej),
    })
    return q
  }
  return {
    from,
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({}) },
    auth: {
      getClaims: async () => ({ data: { claims: { sub: 'u-1', email: 'comercial@agencia.test' } }, error: null }),
      getUser: async () => ({ data: { user: { id: 'u-1', email: 'comercial@agencia.test' } }, error: null }),
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente(), createClient: async () => cliente() }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({ supabase: cliente(), workspaceId: 'ws-1', userId: 'u-1', role: 'owner', staffId: 'staff-1', error: null }),
}))
vi.mock('@/lib/autorizacion-datos/servidor', () => ({
  correoAlCrearNegocio: async () => {},
  estadoDelContacto: async () => {
    t.rpcContacto++
    return {
      estado: {
        existe: t.autorizacion.existe,
        contacto: null, texto: null, aceptacion: null,
        vigente: { generales: t.autorizacion.generales, sensibles: false, menores: t.autorizacion.menores, ofertas: false },
        requiere_reaceptar: false, pendiente: null, manual_sin_evidencia: null,
      },
      error: null,
    }
  },
}))

const { getNegocioDetalleCompleto } = await import('./negocio-v2-actions')
const { MENSAJE_ENVIO } = await import('@/lib/autorizacion-datos/envio')

/** Negocio de viaje en Cotización (E2); el bloque de autorización vive en Solicitud (E1), vacío y pendiente. */
function sembrar(opts: { gateEnLinea: boolean; ninos?: number }) {
  t.tablas = {
    negocios: [{
      id: 'neg-1', workspace_id: 'ws-1', linea_id: 'linea-1', contacto_id: 'c-1', nombre: 'VIAJE DE PRUEBA', codigo: 'P 26 1',
      etapa_actual_id: 'e2', stage_actual: 'venta', estado: 'abierto', metadata: {}, cierre_motivo: null,
      lineas_negocio: { nombre: 'Viaje', numero: 1 }, etapas_negocio: { nombre: 'Cotización', stage: 'venta', numero: 2 },
      empresas: null, contactos: { id: 'c-1', nombre: 'Cliente Ficticio', telefono: null, email: null, rol: null, segmento: null, custom_data: {} },
    }],
    lineas_negocio: [{ id: 'linea-1', config_extra: {} }],
    etapas_negocio: [
      { id: 'e1', linea_id: 'linea-1', stage: 'venta', nombre: 'Solicitud', orden: 1, numero: 1, config_extra: { gates: [] } },
      { id: 'e2', linea_id: 'linea-1', stage: 'venta', nombre: 'Cotización', orden: 2, numero: 2, config_extra: { gates: opts.gateEnLinea ? ['autorizacion_datos'] : [] } },
    ],
    bloque_configs: [
      {
        id: 'bc-aut', etapa_id: 'e1', workspace_id: 'ws-1', bloque_definition_id: 'def-contacto', estado: 'editable', orden: 1,
        es_gate: false, nombre: 'Autorización de datos', slug: 'autorizacion', config_extra: { variante: 'autorizacion' },
        bloque_definitions: { id: 'def-contacto', tipo: 'contacto', nombre: 'Contacto', is_visualization: false, can_be_gate: false },
        etapas_negocio: { id: 'e1', orden: 1, nombre: 'Solicitud', numero: 1 },
      },
    ],
    negocio_bloques: [
      { id: 'nb-aut', negocio_id: 'neg-1', bloque_config_id: 'bc-aut', estado: 'pendiente', data: {} },
      ...(opts.ninos ? [{ id: 'nb-viaje', negocio_id: 'neg-1', bloque_config_id: 'bc-viaje', estado: 'completo', data: { adultos: 2, ninos: opts.ninos } }] : []),
    ],
    workspaces: [{ id: 'ws-1', slug: 'agencia-ficticia', modules: {}, config_extra: {}, cotizacion_template_slug: null }],
  }
}

beforeEach(() => {
  t.autorizacion = { generales: false, menores: false, existe: true }
  t.rpcContacto = 0
})

describe('el aviso de autorización pendiente en Cotización (2026-10-25)', () => {
  it('en E2, con el bloque de E1 vacío y sin firma: pendiente, con el mismo motivo de «Enviar»', async () => {
    sembrar({ gateEnLinea: true })
    const d = await getNegocioDetalleCompleto('neg-1')
    expect(d?.negocio.etapa_actual_id).toBe('e2')
    expect(d?.autorizacionPendiente).toBe(true)
    expect(d?.motivoAutorizacion).toBe(MENSAJE_ENVIO.generales)
  })

  it('firmada: no está pendiente y no hay motivo', async () => {
    sembrar({ gateEnLinea: true })
    t.autorizacion.generales = true
    const d = await getNegocioDetalleCompleto('neg-1')
    expect(d?.autorizacionPendiente).toBe(false)
    expect(d?.motivoAutorizacion).toBeNull()
  })

  it('revocada después de firmar: vuelve a pendiente', async () => {
    sembrar({ gateEnLinea: true })
    t.autorizacion.generales = true
    expect((await getNegocioDetalleCompleto('neg-1'))?.autorizacionPendiente).toBe(false)
    t.autorizacion.generales = false
    expect((await getNegocioDetalleCompleto('neg-1'))?.autorizacionPendiente).toBe(true)
  })

  it('con menores en el viaje y solo la general: pendiente con el motivo de menores', async () => {
    sembrar({ gateEnLinea: true, ninos: 1 })
    t.autorizacion.generales = true
    const d = await getNegocioDetalleCompleto('neg-1')
    expect(d?.autorizacionPendiente).toBe(true)
    expect(d?.motivoAutorizacion).toBe(MENSAJE_ENVIO.menores)
  })

  it('la línea no exige la autorización: nada pendiente y no se consulta el contacto', async () => {
    sembrar({ gateEnLinea: false })
    const d = await getNegocioDetalleCompleto('neg-1')
    expect(d?.autorizacionPendiente).toBe(false)
    expect(d?.motivoAutorizacion).toBeNull()
    expect(t.rpcContacto).toBe(0)
  })

  it('una sola lectura del contacto aunque el bloque de autorización esté en la etapa actual', async () => {
    sembrar({ gateEnLinea: true })
    t.tablas.negocios[0].etapa_actual_id = 'e1'
    const d = await getNegocioDetalleCompleto('neg-1')
    expect(d?.autorizacionPendiente).toBe(true)
    expect(t.rpcContacto).toBe(1)
  })
})
