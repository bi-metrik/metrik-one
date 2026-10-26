/**
 * El ítem «Suscripción» del menú durante la prueba gratis de Valida (2026-10-16): aparece sin contrato
 * si la persona tiene su suscripción en prueba; un espacio con contrato (los CDA) sigue por su contexto
 * de siempre y la prueba ni se mira.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const estado = {
  entrada: { tipo: 'no_aplica' } as Record<string, unknown>,
  prueba: null as Record<string, unknown> | null,
  pruebaLlamadas: 0,
}

vi.mock('./entrada-servidor', () => ({ entradaSuscripcion: async () => estado.entrada }))
vi.mock('./prueba-servidor', () => ({
  suscripcionEnPrueba: async () => {
    estado.pruebaLlamadas += 1
    return estado.prueba
  },
}))
vi.mock('@/lib/valida-api/terminos-servidor', () => ({ designacionDelEspacio: async () => ({ designadoId: 'u-1', designadoNombre: 'Ana' }) }))
vi.mock('@/lib/valida-cda/pago-servidor', () => ({ leerProximoPagoCda: async () => ({ estado: 'error' }) }))
vi.mock('@/lib/valida-cda/puerta', () => ({ moraValidaCda: async () => ({ tipo: 'ok', lectura: { estado: 'error' }, mora: { estado: 'al_dia' } }) }))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (t: string) => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: t === 'servicios_contratados' ? { id: 'sc', estado: 'activo', vigente_desde: '2026-09-23', parametros: {}, workspace_id: 'metrik', servicio_slug: 'valida-cda-licencia' } : null, error: null }) }) }),
        then: (ok: (x: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
      }),
    }),
  }),
}))

const { menuSuscripcion } = await import('./contexto-servidor')

beforeEach(() => {
  estado.entrada = { tipo: 'no_aplica' }
  estado.prueba = null
  estado.pruebaLlamadas = 0
})

describe('el menú «Suscripción»', () => {
  it('sin contrato y con la suscripción en prueba: se muestra, sin punto de color', async () => {
    estado.prueba = { suscripcionId: 's-1', estado: 'prueba' }
    expect(await menuSuscripcion()).toEqual({ tono: null })
  })

  it('sin contrato y sin prueba (AFI, metrik, otra persona del espacio): no se muestra', async () => {
    expect(await menuSuscripcion()).toBeNull()
  })

  it('un CDA con contrato: su contexto de siempre, y la prueba ni se consulta', async () => {
    estado.entrada = {
      tipo: 'ok',
      producto: 'valida_cda',
      entrada: {
        tipo: 'ok',
        workspaceId: 'ws-cda',
        usuarioId: 'u-1',
        usuarioEfectivoId: 'u-1',
        impersonando: false,
        role: 'owner',
        estado: { estado: 'aprobada' },
        hoy: '2026-10-16',
        servicioContratadoId: 'sc',
        plazoTerminos: null,
        enPlazo: false,
      },
    }
    const m = await menuSuscripcion()
    expect(m).not.toBeNull()
    expect(estado.pruebaLlamadas).toBe(0)
  })
})
