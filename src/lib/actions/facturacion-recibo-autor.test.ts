/**
 * El recibo dice QUIÉN lo emitió, incluso cuando quien emite no tiene staff propio.
 *
 * EL CASO QUE IMPORTA: el único `platform_admin` de la base (Mauricio) tiene su `profile`
 * apuntando al workspace del cliente y su fila de `staff` en `metrik`. `getWorkspace`
 * devuelve `staffId: null` a propósito —`staff.id` es FK de `activity_log` y de
 * `negocio_responsables`, y el UNIQUE de `profile_id` es global, así que prestar el id
 * ajeno sería autoría cross-tenant—, y el que llamaba no tenía plan B: escribía `por: null`
 * sin quejarse. En SOENA quedaron **7 marcas de 18 sin autor** (medido el 2026-09-22), la
 * primera del 2026-09-03. El documento existe en Siigo y nadie sabe quién lo emitió.
 *
 * `por` es TEXTO dentro de un jsonb, no una llave foránea: decir el nombre del perfil no
 * arrastra nada de otro inquilino.
 *
 * SE VIERON FALLAR contra `origin/main`:
 *   - "sin staff en el workspace, el nombre sale del perfil" → llegaba null
 *   - "con staff propio manda el staff"                      → pasa en ambas (control)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'

/** Quién dice `getWorkspace` que está operando. Se cambia por prueba. */
let sesion: { staffId: string | null; userId: string | null }
/** Filas que responde la base. `staff` vacío = su registro vive en otro workspace. */
let staff: Record<string, { full_name: string | null }>
let profiles: Record<string, { full_name: string | null }>
/** El tercer argumento con el que se llamó a `emitirReciboDeCobro`: el nombre de quien emite. */
let nombreRecibido: string | null | undefined

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS,
    staffId: sesion.staffId,
    userId: sesion.userId,
    role: 'owner',
    areas: [],
  }),
}))

vi.mock('@/lib/permissions/can-edit', () => ({ canEditBloque: () => true }))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

// Sin red: ninguna prueba de este archivo toca Siigo.
vi.mock('@/lib/siigo/client', () => ({ siigoRequest: async () => ({ results: [] }) }))

vi.mock('@/lib/siigo/recibos', () => ({
  emitirReciboDeCobro: async (_ws: string, _cobro: string, staffNombre: string | null) => {
    nombreRecibido = staffNombre
    return { ok: true, numero: 'RC-1-80', valor: 550035, archivada: true, recibos: [{ numero: 'RC-1-80', valor: 550035 }] }
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (tabla: string) => {
      let id: string | null = null
      const chain = {
        select: () => chain,
        eq: (_col: string, valor: string) => { if (id == null) id = valor; return chain },
        is: () => chain,
        order: () => chain,
        limit: async () => ({ data: [], error: null }),
        maybeSingle: async () => {
          if (tabla === 'staff') return { data: staff[id ?? ''] ?? null, error: null }
          if (tabla === 'profiles') return { data: profiles[id ?? ''] ?? null, error: null }
          if (tabla === 'lineas_negocio') {
            return {
              data: { config_extra: { siigo: { recibo_por_concepto: {
                honorario: { document_id: 4594, concepto: 'Honorarios de asesoría', tipo: 'abono' },
                pasante: { document_id: 33546, concepto: 'Recaudo pago certificación UPME' },
              } } } },
              error: null,
            }
          }
          // El pago trae tarifa UPME: es lo único que Tesorería emite (brief 2026-09-22).
          if (tabla === 'v_cobro_valor') return { data: { a_tarifa: 550035 }, error: null }
          return { data: null, error: null }
        },
        single: async () => ({ data: { linea_id: 'lin-1' }, error: null }),
      }
      return chain
    },
  }),
}))

import { emitirReciboDeNegocio } from './facturacion-actions'

beforeEach(() => {
  nombreRecibido = undefined
  staff = { 's-diana': { full_name: 'Diana Parra' } }
  profiles = { 'u-mauricio': { full_name: 'Mauricio Moreno' } }
  sesion = { staffId: null, userId: 'u-mauricio' }
})

describe('emitirReciboDeNegocio — la marca no queda sin autor', () => {
  it('sin staff en el workspace, el nombre sale del PERFIL del usuario autenticado', async () => {
    const r = await emitirReciboDeNegocio('neg-1', { cobroId: 'c1' })

    expect(r.ok).toBe(true)
    expect(nombreRecibido).toBe('Mauricio Moreno')
  })

  it('con staff propio manda el staff: el perfil es respaldo, no reemplazo', async () => {
    sesion = { staffId: 's-diana', userId: 'u-diana' }
    profiles['u-diana'] = { full_name: 'Diana Parra Gómez' }
    await emitirReciboDeNegocio('neg-1', { cobroId: 'c1' })

    expect(nombreRecibido).toBe('Diana Parra')
  })

  it('sin staff y sin nombre en el perfil, sigue siendo null: no se inventa un autor', async () => {
    profiles = { 'u-mauricio': { full_name: null } }
    await emitirReciboDeNegocio('neg-1', { cobroId: 'c1' })

    expect(nombreRecibido).toBeNull()
  })
})
