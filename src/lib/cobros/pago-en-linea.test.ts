import { describe, it, expect, beforeEach } from 'vitest'
import type { EventoPasarela } from '@/lib/suscripciones/pasarela/adapter'
import { procesarEventoPasarela, type CobroParaPago, type RepoPagoEnLinea } from './pago-en-linea'
import type { ConfirmacionPago } from './confirmar-cobro-programado'

/**
 * Repo en memoria que ESCRIBE: la fila del evento, el cobro confirmado y la nota del negocio quedan
 * donde el siguiente evento las puede ver. Con un doble de solo lectura, «no se registró» y «se
 * registró dos veces» serían indistinguibles.
 */
function repoEnMemoria(cobrosIniciales: CobroParaPago[], enlaces: Record<string, string> = {}) {
  const eventos = new Map<string, { resultado: string }>()
  const cobros = new Map(cobrosIniciales.map((c) => [c.id, { ...c }]))
  const confirmaciones: ConfirmacionPago[] = []
  const notas: string[] = []
  let fallarConfirmacion = false

  const repo: RepoPagoEnLinea = {
    pasarela: 'pasarela-x',
    async registrarEvento(e) {
      const previo = eventos.get(e.eventoId)
      if (previo) return { nuevo: false, resultadoPrevio: previo.resultado }
      eventos.set(e.eventoId, { resultado: 'recibido' })
      return { nuevo: true, resultadoPrevio: null }
    },
    async cerrarEvento(eventoId, r) {
      eventos.set(eventoId, { resultado: r.resultado })
    },
    async cobroPorId(id) {
      const c = cobros.get(id)
      return c ? { ...c } : null
    },
    async cobrosPorIdEnlace(lnk) {
      return [...cobros.values()].filter((c) => enlaces[c.id] === lnk).map((c) => ({ ...c }))
    },
    async confirmarPago(c) {
      if (fallarConfirmacion) return { ok: false, motivo: 'error', error: 'base caída' }
      const cobro = cobros.get(c.cobroId)
      if (!cobro || cobro.fecha || cobro.anuladoAt) return { ok: false, motivo: 'ya_confirmado', error: 'ya' }
      confirmaciones.push(c)
      cobros.set(c.cobroId, {
        ...cobro,
        fecha: c.fecha,
        externalRef: c.externalRef ?? cobro.externalRef,
        monto: c.monto ?? cobro.monto,
        notas: c.notas ?? cobro.notas,
      })
      return { ok: true }
    },
    async anotarEnNegocio(_cobro, texto) {
      notas.push(texto)
    },
  }
  return {
    repo,
    eventos,
    cobros,
    confirmaciones,
    notas,
    fallar(v: boolean) {
      fallarConfirmacion = v
    },
  }
}

const COBRO_ID = '0f8e2f4a-1c2b-4d5e-9f00-112233445566'
const REF = 'ONE-0f8e2f4a1c2b4d5e9f00112233445566-1761063334000'

function cobro(extra: Partial<CobroParaPago> = {}): CobroParaPago {
  return {
    id: COBRO_ID,
    workspaceId: 'ws-metrik',
    negocioId: 'neg-1',
    monto: 250000,
    fecha: null,
    anuladoAt: null,
    tipoCobro: 'programado',
    externalRef: null,
    notas: 'Cuota 1 de 12',
    ...extra,
  }
}

function evento(extra: Partial<EventoPasarela> = {}): EventoPasarela {
  const transaccionId = extra.transaccionId ?? 'TX1'
  return {
    eventoId: 'evt-1',
    tipoOriginal: 'SALE_APPROVED',
    tipo: 'aprobado',
    transaccionId,
    referenciaPago: `px-${transaccionId}`,
    referencia: REF,
    idEnlace: null,
    monto: 250000,
    moneda: 'COP',
    ocurridoAt: '2026-09-25T10:15:00-05:00',
    crudo: {},
    ...extra,
  }
}

const HOY = '2026-09-26'

describe('venta aprobada', () => {
  let m: ReturnType<typeof repoEnMemoria>
  beforeEach(() => {
    m = repoEnMemoria([cobro()])
  })

  it('registra el pago por la vía de confirmar el cobro programado', async () => {
    const s = await procesarEventoPasarela(evento(), m.repo, HOY)
    expect(s.resultado).toBe('registrado')
    expect(m.confirmaciones).toEqual([
      {
        cobroId: COBRO_ID,
        workspaceId: 'ws-metrik',
        fecha: '2026-09-25', // la fecha del pago en Bogotá, no la de hoy
        externalRef: 'px-TX1', // la forma la decide el adaptador
        fuente: 'pasarela-x', // la pasarela del repo, no un nombre fijo
        monto: 250000,
        notas: null,
      },
    ])
    expect(m.eventos.get('evt-1')?.resultado).toBe('registrado')
    expect(m.notas).toHaveLength(1)
  })

  it('la MISMA notificación repetida no vuelve a tocar nada', async () => {
    await procesarEventoPasarela(evento(), m.repo, HOY)
    const s = await procesarEventoPasarela(evento(), m.repo, HOY)
    expect(s.resultado).toBe('duplicado')
    expect(m.confirmaciones).toHaveLength(1)
    expect(m.notas).toHaveLength(1)
  })

  it('OTRA notificación de la misma venta responde «ya pagado» y no escribe', async () => {
    await procesarEventoPasarela(evento(), m.repo, HOY)
    const s = await procesarEventoPasarela(evento({ eventoId: 'evt-2' }), m.repo, HOY)
    expect(s.resultado).toBe('ya_pagado')
    expect(m.confirmaciones).toHaveLength(1)
  })

  it('una venta distinta sobre una cuota ya pagada NO se registra: posible doble pago', async () => {
    await procesarEventoPasarela(evento(), m.repo, HOY)
    const s = await procesarEventoPasarela(evento({ eventoId: 'evt-3', transaccionId: 'TX2' }), m.repo, HOY)
    expect(s.resultado).toBe('requiere_revision')
    expect(m.confirmaciones).toHaveLength(1)
    expect(m.notas.at(-1)).toContain('doble pago')
  })

  it('un pago por más se registra con el monto real y deja la nota del excedente', async () => {
    const s = await procesarEventoPasarela(evento({ monto: 250667 }), m.repo, HOY)
    expect(s.resultado).toBe('registrado')
    expect(m.confirmaciones[0].monto).toBe(250667)
    expect(m.confirmaciones[0].notas).toContain('Cuota 1 de 12')
    expect(m.confirmaciones[0].notas).toContain('$667 de más')
  })

  it('un pago por menos no se registra', async () => {
    const s = await procesarEventoPasarela(evento({ monto: 200000 }), m.repo, HOY)
    expect(s.resultado).toBe('requiere_revision')
    expect(m.confirmaciones).toHaveLength(0)
  })

  it('otra moneda o un monto ilegible no se registran', async () => {
    expect((await procesarEventoPasarela(evento({ moneda: 'USD' }), m.repo, HOY)).resultado).toBe('requiere_revision')
    expect((await procesarEventoPasarela(evento({ eventoId: 'e2', monto: null }), m.repo, HOY)).resultado).toBe('requiere_revision')
    expect(m.confirmaciones).toHaveLength(0)
  })

  it('sin fecha legible del pago usa la de hoy', async () => {
    await procesarEventoPasarela(evento({ ocurridoAt: null }), m.repo, HOY)
    expect(m.confirmaciones[0].fecha).toBe(HOY)
  })

  it('si la base falla, lanza y deja el evento a medias para que el reintento lo procese', async () => {
    m.fallar(true)
    await expect(procesarEventoPasarela(evento(), m.repo, HOY)).rejects.toThrow('base caída')
    expect(m.eventos.get('evt-1')?.resultado).toBe('recibido')
    m.fallar(false)
    const s = await procesarEventoPasarela(evento(), m.repo, HOY)
    expect(s.resultado).toBe('registrado')
    expect(m.confirmaciones).toHaveLength(1)
  })
})

describe('a qué cobro va', () => {
  it('por el id del enlace cuando la pasarela lo manda en vez de la referencia de ONE', async () => {
    const m = repoEnMemoria([cobro()], { [COBRO_ID]: 'LNK_ABC123' })
    const s = await procesarEventoPasarela(evento({ referencia: 'LNK_ABC123', idEnlace: 'LNK_ABC123' }), m.repo, HOY)
    expect(s.resultado).toBe('registrado')
  })

  it('un enlace en dos cobros es ambiguo y no se toca', async () => {
    const otro = cobro({ id: '11111111-2222-3333-4444-555555555555' })
    const m = repoEnMemoria([cobro(), otro], { [COBRO_ID]: 'LNK_X1', [otro.id]: 'LNK_X1' })
    const s = await procesarEventoPasarela(evento({ referencia: 'LNK_X1', idEnlace: 'LNK_X1' }), m.repo, HOY)
    expect(s.resultado).toBe('requiere_revision')
    expect(m.confirmaciones).toHaveLength(0)
  })

  it('una venta de Bold por otro canal no toca ningún cobro', async () => {
    const m = repoEnMemoria([cobro()])
    expect((await procesarEventoPasarela(evento({ referencia: 'WEB-ORD-1' }), m.repo, HOY)).resultado).toBe('sin_cobro')
    expect((await procesarEventoPasarela(evento({ eventoId: 'e2', referencia: null }), m.repo, HOY)).resultado).toBe('sin_cobro')
    expect(m.confirmaciones).toHaveLength(0)
  })

  it('un cobro anulado o que no es de cuota no se paga', async () => {
    const anulado = repoEnMemoria([cobro({ anuladoAt: '2026-09-20T00:00:00Z' })])
    expect((await procesarEventoPasarela(evento(), anulado.repo, HOY)).resultado).toBe('requiere_revision')
    const suelto = repoEnMemoria([cobro({ tipoCobro: 'pago' })])
    expect((await procesarEventoPasarela(evento(), suelto.repo, HOY)).resultado).toBe('requiere_revision')
    expect(anulado.confirmaciones.length + suelto.confirmaciones.length).toBe(0)
  })
})

describe('otros eventos', () => {
  it('una venta rechazada se ignora', async () => {
    const m = repoEnMemoria([cobro()])
    const s = await procesarEventoPasarela(evento({ tipo: 'rechazado', tipoOriginal: 'SALE_REJECTED' }), m.repo, HOY)
    expect(s.resultado).toBe('ignorado')
    expect(m.confirmaciones).toHaveLength(0)
  })

  it('una anulación aprobada no deshace el pago: pide revisión', async () => {
    const m = repoEnMemoria([cobro({ fecha: '2026-09-25', externalRef: 'px-TX1' })])
    const s = await procesarEventoPasarela(evento({ tipo: 'anulado', tipoOriginal: 'VOID_APPROVED' }), m.repo, HOY)
    expect(s.resultado).toBe('requiere_revision')
    expect(m.cobros.get(COBRO_ID)?.fecha).toBe('2026-09-25')
  })
})
