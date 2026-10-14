/**
 * La factura electrónica cuelga del registro del pago en línea, sin poder tumbarlo: se pide en un
 * pago registrado y en su reintento (`ya_pagado`), no en un rechazo, y si lanza el pago queda igual.
 */
import { describe, expect, it } from 'vitest'
import type { EventoPasarela } from '@/lib/suscripciones/pasarela/adapter'
import { procesarEventoPasarela, type CobroParaPago, type RepoPagoEnLinea } from './pago-en-linea'

const COBRO_ID = '0f8e2f4a-1c2b-4d5e-9f00-112233445566'
const REF = 'ONE-0f8e2f4a1c2b4d5e9f00112233445566-1761063334000'

function montar(opciones: { facturaLanza?: boolean; trasPago?: { revisar: boolean; detalle: string } | null } = {}) {
  const eventos = new Map<string, string>()
  let cobro: CobroParaPago = {
    id: COBRO_ID,
    workspaceId: 'ws-metrik',
    negocioId: 'neg-1',
    monto: 150000,
    fecha: null,
    anuladoAt: null,
    tipoCobro: 'programado',
    externalRef: null,
    notas: null,
  }
  const facturados: string[] = []
  const repo: RepoPagoEnLinea = {
    pasarela: 'epayco',
    async registrarEvento(e) {
      const previo = eventos.get(e.eventoId)
      if (previo) return { nuevo: false, resultadoPrevio: previo }
      eventos.set(e.eventoId, 'recibido')
      return { nuevo: true, resultadoPrevio: null }
    },
    async cerrarEvento(id, r) {
      eventos.set(id, r.resultado)
    },
    async cobroPorId() {
      return { ...cobro }
    },
    async cobrosPorIdEnlace() {
      return []
    },
    async confirmarPago(c) {
      cobro = { ...cobro, fecha: c.fecha, externalRef: c.externalRef ?? null }
      return { ok: true }
    },
    async anotarEnNegocio() {},
    ...(opciones.trasPago !== undefined ? { trasPagoRegistrado: async () => opciones.trasPago ?? null } : {}),
    async facturarPago(c) {
      facturados.push(c.id)
      if (opciones.facturaLanza) throw new Error('Aliaddo caído')
    },
  }
  return { repo, facturados }
}

function evento(extra: Partial<EventoPasarela> = {}): EventoPasarela {
  return {
    eventoId: 'evt-1',
    tipoOriginal: 'Aceptada',
    tipo: 'aprobado',
    transaccionId: 'TX1',
    referencia: REF,
    referenciaPago: 'epayco:TX1',
    idEnlace: null,
    monto: 150000,
    moneda: 'COP',
    ocurridoAt: '2026-10-20T10:00:00-05:00',
    crudo: {},
    ...extra,
  }
}

describe('factura tras el pago en línea', () => {
  it('pago registrado: se pide la factura una vez', async () => {
    const { repo, facturados } = montar()
    const r = await procesarEventoPasarela(evento(), repo, '2026-10-20')
    expect(r.resultado).toBe('registrado')
    expect(facturados).toEqual([COBRO_ID])
  })

  it('otra notificación de la misma transacción (ya_pagado) la vuelve a pedir: encolar es idempotente', async () => {
    const { repo, facturados } = montar()
    await procesarEventoPasarela(evento(), repo, '2026-10-20')
    const r = await procesarEventoPasarela(evento({ eventoId: 'evt-2' }), repo, '2026-10-20')
    expect(r.resultado).toBe('ya_pagado')
    expect(facturados).toEqual([COBRO_ID, COBRO_ID])
  })

  it('un pago rechazado no se factura', async () => {
    const { repo, facturados } = montar()
    await procesarEventoPasarela(evento({ tipo: 'rechazado' }), repo, '2026-10-20')
    expect(facturados).toEqual([])
  })

  it('si la factura lanza, el pago queda registrado igual', async () => {
    const { repo, facturados } = montar({ facturaLanza: true })
    const r = await procesarEventoPasarela(evento(), repo, '2026-10-20')
    expect(r.resultado).toBe('registrado')
    expect(facturados).toHaveLength(1)
  })

  it('se factura aunque lo que sigue al pago pida revisión, y la revisión se conserva', async () => {
    const { repo, facturados } = montar({ trasPago: { revisar: true, detalle: 'Plan anual NO activado.' } })
    const r = await procesarEventoPasarela(evento(), repo, '2026-10-20')
    expect(r.resultado).toBe('requiere_revision')
    expect(r.detalle).toContain('Plan anual NO activado.')
    expect(facturados).toEqual([COBRO_ID])
  })
})
