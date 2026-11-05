/**
 * Las reglas puras del bloque «Pagar» de un CDA (brief del 2026-11-03): qué estado del enlace de Bold deja
 * cobrar la tarjeta, qué cuota admite «Pagar solo este mes» y qué enlaces se retiran al registrar la tarjeta.
 */
import { describe, expect, it } from 'vitest'
import type { CuotaConEstado } from './pago-pendiente'
import { cuotasConEnlaceARetirar, estadoDelEnlace, mesPorEnlace, textoPagoPorEnlaceEnCurso } from './pago-unico'

const PLAN = 'Suscripción VALIDA · Plan CDA — mensual'
const LNK = 'https://checkout.bold.co/LNK_ABC123'

function cuota(numero: number, desde: string, hasta: string, vence: string, extra: Partial<CuotaConEstado> = {}): CuotaConEstado {
  return {
    cuotaId: `q${numero}`,
    numero,
    concepto: `${PLAN} · periodo del ${desde} al ${hasta}`,
    fechaVencimiento: vence,
    monto: 150000,
    abonado: 0,
    saldo: 150000,
    estado: 'pendiente',
    enlacePago: null,
    factura: null,
    ...extra,
  }
}

// La tarjeta se registró el 2-nov: el 23-oct es atrasado (D3); el 23-nov lo cobra la tarjeta.
const ATRASADA = cuota(2, '23-oct', '22-nov', '2026-10-27', { estado: 'vencida', enlacePago: LNK })
const DE_LA_TARJETA = cuota(3, '23-nov', '22-dic', '2026-11-27', { enlacePago: 'https://checkout.bold.co/LNK_DEF456' })
const TARJETA = { cobroDesde: '2026-11-02' }

describe('el estado del enlace de Bold antes de un cargo', () => {
  it('PROCESSING y PAID frenan la tarjeta; ACTIVE, REJECTED, CANCELLED y EXPIRED la dejan', () => {
    expect(estadoDelEnlace('LNK_A', { ok: true, estado: 'PROCESSING' })).toEqual({ tipo: 'en_curso', estado: 'PROCESSING', idEnlace: 'LNK_A' })
    expect(estadoDelEnlace('LNK_A', { ok: true, estado: 'paid' })).toEqual({ tipo: 'en_curso', estado: 'PAID', idEnlace: 'LNK_A' })
    for (const e of ['ACTIVE', 'REJECTED', 'CANCELLED', 'EXPIRED']) expect(estadoDelEnlace('LNK_A', { ok: true, estado: e })).toEqual({ tipo: 'libre' })
  })

  it('sin poder consultar, o con un estado desconocido, no se cobra', () => {
    expect(estadoDelEnlace('LNK_A', { ok: false, error: 'HTTP 503' }).tipo).toBe('sin_consulta')
    expect(estadoDelEnlace('LNK_A', { ok: true, estado: '' }).tipo).toBe('sin_consulta')
    expect(estadoDelEnlace('LNK_A', { ok: true, estado: 'ON_HOLD' }).tipo).toBe('sin_consulta')
  })

  it('le dice a la persona por qué no se cobró la tarjeta', () => {
    expect(textoPagoPorEnlaceEnCurso('23-oct al 22-nov de 2026', { tipo: 'en_curso', estado: 'PROCESSING', idEnlace: 'LNK_A' })).toBe(
      'Tu pago del período 23-oct al 22-nov de 2026 por PSE u otro medio está en curso: no cobramos la tarjeta. Si el banco lo rechaza, puedes volver a intentarlo.',
    )
  })
})

describe('«Pagar solo este mes» (PSE u otro medio)', () => {
  it('sin tarjeta: la cuota más vieja con saldo, con su enlace vigente si lo tiene', () => {
    expect(mesPorEnlace({ cuotas: [ATRASADA, DE_LA_TARJETA], tarjeta: null, rechazadas: new Set(), conCargo: new Set() })).toEqual({
      cuotaId: 'q2',
      numero: 2,
      saldo: 150000,
      enlace: LNK,
    })
  })

  it('con tarjeta: lo atrasado sí se paga por enlace (la tarjeta no lo cobra sola)', () => {
    expect(mesPorEnlace({ cuotas: [ATRASADA, DE_LA_TARJETA], tarjeta: TARJETA, rechazadas: new Set(), conCargo: new Set() })?.numero).toBe(2)
  })

  it('con tarjeta: el período que cobra la tarjeta NO ofrece enlace, salvo que la tarjeta lo haya rechazado', () => {
    expect(mesPorEnlace({ cuotas: [DE_LA_TARJETA], tarjeta: TARJETA, rechazadas: new Set(), conCargo: new Set() })).toBeNull()
    expect(mesPorEnlace({ cuotas: [DE_LA_TARJETA], tarjeta: TARJETA, rechazadas: new Set([3]), conCargo: new Set() })?.numero).toBe(3)
  })

  it('con un cargo a la tarjeta en curso, pendiente o aprobado no hay enlace, ni siquiera de lo atrasado', () => {
    expect(mesPorEnlace({ cuotas: [ATRASADA], tarjeta: TARJETA, rechazadas: new Set(), conCargo: new Set([2]) })).toBeNull()
  })

  it('todo pagado: nada que pagar', () => {
    expect(mesPorEnlace({ cuotas: [cuota(1, '23-sep', '22-oct', '2026-09-30', { estado: 'pagada', saldo: 0 })], tarjeta: null, rechazadas: new Set(), conCargo: new Set() })).toBeNull()
  })
})

describe('al registrar la tarjeta', () => {
  it('se retiran los enlaces de lo que la tarjeta cobra sola; lo atrasado conserva el suyo', () => {
    expect(cuotasConEnlaceARetirar([ATRASADA, DE_LA_TARJETA], TARJETA.cobroDesde)).toEqual([3])
  })
})
