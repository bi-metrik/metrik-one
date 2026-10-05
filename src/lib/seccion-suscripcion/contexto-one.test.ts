/**
 * El contexto de `/suscripcion` para la licencia de ONE de un cliente de Clarity (Termotech,
 * 2026-10-05): la próxima cuota y la mora salen de las RPC del contrato (no de la puerta de Valida,
 * que para este espacio no aplica), y el resumen habla de ONE, sin pausa.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const WS = 'b4d2ace9-7141-49a6-a34e-53461b55c85b'
const SC = '11111111-1111-4111-8111-111111111111'
const OMAR = '64864a69-f5b5-4f33-96bf-99fe2b3bbe4c'

const espias = {
  leerProximoPagoCda: vi.fn(async (_sc: string, _hoy: string) => ({
    estado: 'ok' as const,
    pago: {
      estado: 'pendiente' as const,
      numero: 2,
      concepto: null,
      fechaVencimiento: '2026-10-05',
      monto: 150000,
      abonado: 0,
      saldo: 150000,
      vencida: true,
      enlacePago: 'https://checkout.bold.co/payment/LNK_X',
      enlaceVencido: false,
    },
  })),
  moraValidaCda: vi.fn(async () => ({ tipo: 'no_aplica' as const })),
}

vi.mock('./entrada-servidor', () => ({
  entradaSuscripcion: async () => ({
    tipo: 'ok',
    producto: 'one',
    entrada: {
      tipo: 'ok',
      workspaceId: WS,
      usuarioId: OMAR,
      usuarioEfectivoId: OMAR,
      impersonando: false,
      role: 'owner',
      estado: { estado: 'aprobada' },
      hoy: '2026-10-07',
      servicioContratadoId: SC,
      plazoTerminos: null,
      enPlazo: false,
    },
  }),
}))
vi.mock('@/lib/valida-cda/pago-servidor', () => ({ leerProximoPagoCda: espias.leerProximoPagoCda }))
vi.mock('@/lib/valida-cda/puerta', () => ({ moraValidaCda: espias.moraValidaCda }))
vi.mock('@/lib/valida-api/terminos-servidor', () => ({
  designacionDelEspacio: async () => ({ designadoId: OMAR, designadoNombre: 'Omar Castro' }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (tabla: string) => {
      const data =
        tabla === 'servicios_contratados'
          ? {
              id: SC,
              estado: 'activo',
              vigente_desde: '2026-09-05',
              vigente_hasta: '2027-03-04',
              parametros: { precio_mensual: 150000 },
              empresa_id: 'termotech-en-metrik',
              negocio_id: 'a3-26-2',
              workspace_id: 'metrik',
              comision: null,
              servicio_slug: 'licencia-clarity',
              empresas: { nombre: 'Termotech', razon_social: 'TERMOTECH SAS' },
            }
          : [{ slug: 'licencia-clarity', nombre: 'Licencia Clarity' }]
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok),
      }
      return q
    },
  }),
}))

const { contextoSuscripcion } = await import('./contexto-servidor')

beforeEach(() => {
  espias.leerProximoPagoCda.mockClear()
  espias.moraValidaCda.mockClear()
})

describe('contexto de /suscripcion para la licencia de ONE', () => {
  it('la cuota sale de las RPC del contrato y no de la puerta de Valida', async () => {
    const ctx = await contextoSuscripcion()
    if (ctx.tipo !== 'ok') throw new Error(`esperaba ok, vino ${ctx.tipo}`)
    expect(ctx.producto).toBe('one')
    expect(espias.leerProximoPagoCda).toHaveBeenCalledWith(SC, '2026-10-07')
    expect(espias.moraValidaCda).not.toHaveBeenCalled()
    expect(ctx.contrato).toMatchObject({ id: SC, empresaNombre: 'TERMOTECH SAS', cobradorId: 'metrik', servicioNombre: 'Licencia Clarity' })
    expect(ctx.pago).toMatchObject({ estado: 'ok', pago: { numero: 2, enlacePago: 'https://checkout.bold.co/payment/LNK_X' } })
  })

  it('la cuota vencida se dice vencida, sin la pausa de Valida', async () => {
    const ctx = await contextoSuscripcion()
    if (ctx.tipo !== 'ok') throw new Error(`esperaba ok, vino ${ctx.tipo}`)
    expect(ctx.mora).toMatchObject({ estado: 'en_mora', vencio: '2026-10-05' })
    expect(ctx.resumen).toMatchObject({ estado: 'en_mora', chip: 'Cuota vencida' })
    expect(ctx.resumen.mensaje).not.toMatch(/pausa|Valida/i)
    expect(ctx.soloLectura).toBe(false)
  })
})
