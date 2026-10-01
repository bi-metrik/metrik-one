/**
 * La propuesta económica con tarifas por plan y ruta, de punta a punta por las acciones
 * reales (`getTarifaPropuesta`, `generarVersionPropuesta`, `aprobarVersionPropuesta`)
 * contra un doble de Supabase. Los casos son los de «Cómo se verifica» del brief del
 * 2026-10-01, con datos inventados: ningún negocio ni cliente real.
 *
 *   - creado el 1-oct, Solo UPME, Plan 2 → $341.250, piso $255.938 (25 %);
 *   - Solo DIAN → el Plan 1 no aparece ni se aprueba;
 *   - creado en septiembre → esquema anterior, igual que antes;
 *   - propuesta ya emitida con el esquema anterior el 1-oct → no cambia de esquema;
 *   - la ruta cambia antes de aprobar → no se aprueba sin una versión nueva.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Fila = Record<string, unknown>

const TARIFA_V1: Fila = {
  id: 'tv1',
  servicio_id: 'svc-1',
  version: 1,
  vigente_desde: '2026-10-01',
  planes: [
    { n: 1, nombre: 'Plan 1 (tarifa plena)', valor: 910000 },
    { n: 2, nombre: 'Plan 2 (pago anticipado)', valor: 682500 },
  ],
  rutas: [
    { valor: 'completo', nombre: 'Completo', pct: 100 },
    { valor: 'solo_upme', nombre: 'Solo UPME', pct: 50 },
    { valor: 'solo_iva', nombre: 'Solo DIAN', pct: 80 },
  ],
  no_ofrece: [{ plan: 1, ruta: 'solo_iva' }],
  cap_descuento_pct: '25.00',
  creado_por: null,
  created_at: '2026-10-01T12:00:00Z',
  nota: null,
}

const esc: {
  data: Fila
  estado: string
  ruta: string | null
  creado: string
  tarifas: Fila[]
  precioAprobado: number | null
  pdf: Fila | null
} = { data: {}, estado: 'pendiente', ruta: null, creado: '', tarifas: [], precioAprobado: null, pdf: null }

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: { from: (t: string) => consulta(t), rpc: async () => ({ data: null, error: null }) },
    workspaceId: 'ws-1',
    staffId: null,
    role: 'operator',
    userId: 'u-1',
    error: null,
  }),
}))
vi.mock('@/lib/permissions/guard-negocio', () => ({ guardEditarBloque: async () => ({ ok: true }) }))
vi.mock('@/lib/supabase/auth-user', () => ({ getCachedUser: async () => ({ user: null }) }))
vi.mock('@/lib/pdf/pdf-render-client', () => ({
  renderPropuestaEconomica: async (_slug: string, payload: Fila) => {
    esc.pdf = payload
    return Buffer.from('pdf')
  },
}))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({ almacenamientoExternoDe: async () => null }))
vi.mock('@/lib/google-drive', () => ({ createSubfolderPath: async () => '', uploadFileToDrive: async () => ({}) }))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => {} }))

function bloque(): Fila {
  return {
    id: 'blq-1',
    negocio_id: 'neg-1',
    estado: esc.estado,
    data: esc.data,
    bloque_config_id: 'cfg-1',
    bloque_configs: {
      config_extra: {
        auto_propuesta: { servicio_id: 'svc-1' },
        cap_descuento_pct: 100,
        umbral_aprobacion_pct: 50,
      },
      bloque_definitions: { tipo: 'propuesta_economica' },
    },
  }
}

function consulta(tabla: string) {
  const f: Fila = {}
  let op: 'select' | 'update' = 'select'
  let payload: Fila = {}

  const resolver = (unico: boolean) => {
    if (tabla === 'negocio_bloques') {
      if (f.id) return { data: bloque(), error: null }
      if (f['bloque_configs.slug'] === 'servicio_contratado') {
        return { data: esc.ruta ? [{ negocio_id: 'neg-1', data: { servicio: esc.ruta } }] : [], error: null }
      }
      return { data: unico ? null : [], error: null }
    }
    if (tabla === 'servicio_tarifas_versiones') return { data: esc.tarifas, error: null }
    if (tabla === 'negocios') return { data: { created_at: esc.creado, codigo: 'X 26 1', carpeta_url: null }, error: null }
    if (tabla === 'servicios') return { data: { precio_estandar: 714286, tarifa_iva: 0.19 }, error: null }
    throw new Error(`tabla inesperada en el doble: ${tabla}`)
  }

  const q: Record<string, unknown> = {
    select: () => q,
    eq: (c: string, v: unknown) => { f[c] = v; return q },
    in: () => q,
    not: () => q,
    order: () => q,
    limit: () => q,
    update: (p: Fila) => { op = 'update'; payload = p; return q },
    single: async () => resolver(true),
    maybeSingle: async () => resolver(true),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (op === 'update') {
        if (tabla === 'negocio_bloques') {
          esc.data = payload.data as Fila
          if (payload.estado) esc.estado = payload.estado as string
        }
        if (tabla === 'negocios' && 'precio_aprobado' in payload) esc.precioAprobado = payload.precio_aprobado as number
        return Promise.resolve({ error: null }).then(ok, ko)
      }
      return Promise.resolve(resolver(false)).then(ok, ko)
    },
  }
  return q
}

import {
  aprobarVersionPropuesta,
  generarVersionPropuesta,
  getTarifaPropuesta,
} from '@/lib/actions/propuesta-economica-actions'

beforeEach(() => {
  // Como lo deja `crearV1Automatica`: base del precio estándar (850.000), sin versiones.
  esc.data = { precio_base_con_iva: 850000, iva_pct: 0.19, descuento_pct_plan1: 0, descuento_pct_plan2: 0, versiones: [] }
  esc.estado = 'pendiente'
  esc.ruta = 'solo_upme'
  esc.creado = '2026-10-01T15:00:00Z'
  esc.tarifas = [TARIFA_V1]
  esc.precioAprobado = null
  esc.pdf = null
})

describe('negocio creado desde el 1-oct', () => {
  it('Solo UPME: la propuesta toma la casilla de cada plan sola', async () => {
    const r = await getTarifaPropuesta('blq-1')
    expect(r.ok && r.tarifa).toMatchObject({
      esquema: 'tarifas',
      cap_descuento_pct: 25,
      ruta: 'solo_upme',
      planes: [
        { n: 1, ofrece: true, valor: 455000 },
        { n: 2, ofrece: true, valor: 341250 },
      ],
    })
  })

  it('Solo UPME, Plan 2: $341.250 y no deja bajar de $255.938', async () => {
    const pasado = await generarVersionPropuesta('blq-1', { descuento_pct_plan1: 0, descuento_pct_plan2: 25.01 })
    expect(pasado).toMatchObject({ ok: false, error: expect.stringMatching(/cap de 25%/) })

    const r = await generarVersionPropuesta('blq-1', { descuento_pct_plan1: 0, descuento_pct_plan2: 25 })
    expect(r.ok).toBe(true)
    expect(r.version).toMatchObject({
      valor_final_plan1: 455000,
      valor_final_plan2: 255938,
      base_plan2: 341250,
      tarifa_version_id: 'tv1',
      planes_ofrecidos: [1, 2],
      servicio: 'solo_upme',
    })
    // El negocio queda atado a la versión de tarifas con la que se armó.
    expect(esc.data.tarifa).toMatchObject({ version_id: 'tv1', version: 1, cap_descuento_pct: 25 })

    const a = await aprobarVersionPropuesta('blq-1', 1, 2)
    expect(a).toEqual({ ok: true })
    expect(esc.precioAprobado).toBe(255938)
    expect(esc.data.tarifa).toMatchObject({ version_id: 'tv1' })
  })

  it('Solo DIAN: el Plan 1 no aparece, no lleva cifra en el PDF y no se aprueba', async () => {
    esc.ruta = 'solo_iva'
    const t = await getTarifaPropuesta('blq-1')
    expect(t.ok && t.tarifa.esquema === 'tarifas' && t.tarifa.planes[0]).toMatchObject({ n: 1, ofrece: false })

    const r = await generarVersionPropuesta('blq-1', { descuento_pct_plan1: 10, descuento_pct_plan2: 0 })
    expect(r.version).toMatchObject({ planes_ofrecidos: [2], valor_final_plan1: 0, valor_final_plan2: 546000 })
    expect(esc.pdf).toMatchObject({ plan1_valor: 'No aplica', plan1_estilo: 'display:none', plan2_estilo: '' })

    expect(await aprobarVersionPropuesta('blq-1', 1, 1)).toMatchObject({ ok: false, error: expect.stringMatching(/no se ofrece/) })
    expect(esc.precioAprobado).toBeNull()
    expect(await aprobarVersionPropuesta('blq-1', 1, 2)).toEqual({ ok: true })
    expect(esc.precioAprobado).toBe(546000)
  })

  it('si la ruta cambia antes de aprobar, no se aprueba sin una versión nueva', async () => {
    await generarVersionPropuesta('blq-1', { descuento_pct_plan1: 0, descuento_pct_plan2: 0 })
    esc.ruta = 'completo'
    expect(await aprobarVersionPropuesta('blq-1', 1, 2)).toMatchObject({ ok: false, error: expect.stringMatching(/ruta del negocio cambió/) })

    const v2 = await generarVersionPropuesta('blq-1', { descuento_pct_plan1: 0, descuento_pct_plan2: 0 })
    expect(v2.version).toMatchObject({ n: 2, valor_final_plan2: 682500, servicio: 'completo' })
    expect(await aprobarVersionPropuesta('blq-1', 2, 2)).toEqual({ ok: true })
    expect(esc.precioAprobado).toBe(682500)
  })

  it('una propuesta que ya salió con el esquema anterior no cambia de valor', async () => {
    esc.data = {
      ...esc.data,
      versiones: [{ n: 1, descuento_pct_plan1: 0, descuento_pct_plan2: 25, valor_final_plan1: 850000, valor_final_plan2: 637500, servicio: 'completo' }],
      version_activa: 1,
    }
    const t = await getTarifaPropuesta('blq-1')
    expect(t.ok && t.tarifa).toEqual({ esquema: 'anterior', motivo: 'emitida_antes' })
  })
})

describe('negocio creado en septiembre', () => {
  it('sigue con precio estándar + descuento manual y el tope del bloque', async () => {
    esc.creado = '2026-09-30T20:00:00Z' // 15:00 del 30-sep en Bogotá
    const t = await getTarifaPropuesta('blq-1')
    expect(t.ok && t.tarifa).toEqual({ esquema: 'anterior', motivo: 'creado_antes' })

    const r = await generarVersionPropuesta('blq-1', { descuento_pct_plan1: 0, descuento_pct_plan2: 50 })
    expect(r.version).toMatchObject({ valor_final_plan1: 850000, valor_final_plan2: 425000 })
    expect(r.version?.tarifa_version_id).toBeUndefined()
    expect(esc.data.tarifa).toBeUndefined()
  })
})
