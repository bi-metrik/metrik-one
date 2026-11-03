/**
 * Un doble pago que igual entra (brief del 2026-11-03): la cuota ya estaba pagada (por la tarjeta o por el
 * enlace) y llega otro pago aprobado. No se registra, queda marcado PARA DEVOLUCIÓN y se avisa a MéTRIK.
 */
import { describe, expect, it, vi } from 'vitest'
import { crearDoble } from '../../../test/tablas-doble'
import type { EventoPasarela, PasarelaAdapter } from '@/lib/suscripciones/pasarela/adapter'
import type { CorreoInterno } from './reverso-pasarela-servidor'

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => null }))
const actividad: string[] = []
vi.mock('@/lib/activity/registrar-actividad', () => ({
  registrarActividad: async (_db: unknown, fila: { contenido: string }) => {
    actividad.push(fila.contenido)
  },
}))

const { procesarEventoPasarela } = await import('./pago-en-linea')
const { repoPagoEnLinea } = await import('./pago-en-linea-servidor')

const COBRO = '0f8e2f4a-1c2b-4d5e-9f00-112233445566'
const REF_ONE = 'ONE-0f8e2f4a1c2b4d5e9f00112233445566-1761063334000'

function evento(extra: Partial<EventoPasarela> = {}): EventoPasarela {
  return {
    eventoId: 'evt-bold-2',
    tipoOriginal: 'SALE_APPROVED',
    tipo: 'aprobado',
    transaccionId: 'TXBOLD2',
    referenciaPago: 'bold-TXBOLD2',
    referencia: REF_ONE,
    idEnlace: null,
    monto: 150000,
    moneda: 'COP',
    ocurridoAt: '2026-11-23T10:00:00-05:00',
    crudo: {},
    ...extra,
  }
}

function base() {
  return crearDoble({
    pasarela_eventos: [],
    // La tarjeta ya cobró la cuota el 23-nov.
    cobros: [
      {
        id: COBRO,
        workspace_id: 'ws-metrik',
        negocio_id: 'n1',
        monto: 150000,
        retencion_iva: 0,
        fecha: '2026-11-23',
        anulado_at: null,
        tipo_cobro: 'programado',
        external_ref: 'epayco-10',
        notas: 'Cuota 3 · cobro con tarjeta (ePayco)',
        enlace_pago_url: 'https://checkout.bold.co/LNK_DEF456',
      },
    ],
  })
}

const adapter = { nombre: 'bold', capacidades: {}, idEnlaceDeUrl: () => null } as unknown as PasarelaAdapter

describe('el doble pago que igual entra', () => {
  it('pago por Bold sobre la cuota ya cobrada con la tarjeta: no se registra, queda PARA DEVOLUCIÓN y se avisa a MéTRIK', async () => {
    actividad.length = 0
    const d = base()
    const correos: CorreoInterno[] = []
    const enviarCorreo = async (m: CorreoInterno) => {
      correos.push(m)
      return { ok: true as const }
    }
    const r = await procesarEventoPasarela(evento(), repoPagoEnLinea(d.db, 'bold', adapter, { enviarCorreo }), '2026-11-23')

    expect(r.resultado).toBe('requiere_revision')
    expect(r.detalle).toContain('posible doble pago')
    expect(r.detalle).toContain('PARA DEVOLUCIÓN: la devolución la hace una persona (no se automatiza sin decisión de Carmen). Aviso enviado a MéTRIK.')
    // El cobro sigue con el pago de la tarjeta: el de Bold no lo pisa.
    expect(d.tablas.cobros[0]).toMatchObject({ fecha: '2026-11-23', external_ref: 'epayco-10' })
    expect(d.tablas.pasarela_eventos[0]).toMatchObject({ resultado: 'requiere_revision' })
    expect(String(d.tablas.pasarela_eventos[0].detalle)).toContain('PARA DEVOLUCIÓN')

    expect(correos).toHaveLength(1)
    expect(correos[0]).toMatchObject({ to: 'mauricio.moreno@metrik.com.co', idempotencyKey: 'doble-pago-bold-TXBOLD2' })
    expect(correos[0].subject).toBe('Doble pago en Bold: devolver $150.000')
    expect(correos[0].text).toContain('Pago que ya tenía la cuota: epayco-10, del 2026-11-23')
    expect(actividad[0]).toMatch(/^Pago en línea · revisar: .*posible doble pago/)
  })

  it('si el correo no sale, lo dice en la marca (no lo calla)', async () => {
    const d = base()
    const r = await procesarEventoPasarela(
      evento(),
      repoPagoEnLinea(d.db, 'bold', adapter, { enviarCorreo: async () => ({ ok: false, error: 'sin RESEND_API_KEY' }) }),
      '2026-11-23',
    )
    expect(r.detalle).toContain('PARA DEVOLUCIÓN')
    expect(r.detalle).toContain('El aviso a MéTRIK NO salió (sin RESEND_API_KEY).')
  })

  it('dos notificaciones de la misma transacción llevan la misma llave a Resend: un solo correo', async () => {
    // Bold manda varias notificaciones de una transacción (otro id de evento): la llave es la transacción.
    const llaves: string[] = []
    const enviarCorreo = async (m: CorreoInterno) => {
      llaves.push(m.idempotencyKey)
      return { ok: true as const }
    }
    await procesarEventoPasarela(evento(), repoPagoEnLinea(base().db, 'bold', adapter, { enviarCorreo }), '2026-11-23')
    await procesarEventoPasarela(evento({ eventoId: 'evt-bold-3' }), repoPagoEnLinea(base().db, 'bold', adapter, { enviarCorreo }), '2026-11-23')
    expect(llaves).toEqual(['doble-pago-bold-TXBOLD2', 'doble-pago-bold-TXBOLD2'])
  })

  it('el mismo pago que vuelve a llegar NO es doble pago ni se avisa', async () => {
    const d = base()
    let n = 0
    const r = await procesarEventoPasarela(
      evento({ eventoId: 'evt-epayco', referenciaPago: 'epayco-10', transaccionId: '10' }),
      repoPagoEnLinea(d.db, 'epayco', adapter, {
        enviarCorreo: async () => {
          n += 1
          return { ok: true as const }
        },
      }),
      '2026-11-23',
    )
    expect(r.resultado).toBe('ya_pagado')
    expect(n).toBe(0)
  })
})
