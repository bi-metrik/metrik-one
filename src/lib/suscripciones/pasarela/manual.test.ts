import { describe, it, expect } from 'vitest'
import { pasarelaManual } from './manual'
import { adapterPara } from './registro'
import { referenciaCargo, type SolicitudCargo } from './adapter'

const solicitud: SolicitudCargo = {
  referencia: 'sub-abc-c1',
  suscripcionId: 'abc',
  workspaceId: 'ws-cliente',
  cobroId: 'cobro-1',
  planCobroId: 'plan-1',
  numeroCuota: 1,
  monto: 150_000,
  moneda: 'COP',
  descripcion: 'Licencia ONE — cuota 1 de 6',
  facturaRef: null,
  medioPago: null,
  cliente: null,
}

describe('pasarela manual', () => {
  it('no cobra: todo cargo queda pendiente y sin referencia externa', async () => {
    const r = await pasarelaManual.cobrar(solicitud)
    expect(r.estado).toBe('pendiente')
    if (r.estado === 'pendiente') expect(r.externalRef).toBeNull()
  })

  it('consultar tampoco resuelve nada', async () => {
    expect((await pasarelaManual.consultar('x')).estado).toBe('pendiente')
  })

  it('declara que no sabe hacer nada automatico', () => {
    expect(pasarelaManual.capacidades).toEqual({ cobroSinClic: false, tokenizacion: false, linkDePago: false, webhook: false })
    expect(pasarelaManual.verificarWebhook).toBeUndefined()
  })
})

describe('adapterPara', () => {
  it('resuelve manual y deja las demas sin adaptador en Fase 1', () => {
    expect(adapterPara('manual')).toBe(pasarelaManual)
    expect(adapterPara('bold')).toBeNull()
    expect(adapterPara('epayco')).toBeNull()
    expect(adapterPara('wompi')).toBeNull()
  })
})

describe('referenciaCargo', () => {
  it('es determinista por (suscripcion, cuota) y cabe en 30 caracteres', () => {
    const a = referenciaCargo('0f8e2f4a-1c2b-4d5e-9f00-112233445566', 3)
    expect(a).toBe('sub-0f8e2f4a1c2b-c3')
    expect(referenciaCargo('0f8e2f4a-1c2b-4d5e-9f00-112233445566', 3)).toBe(a)
    expect(referenciaCargo('0f8e2f4a-1c2b-4d5e-9f00-112233445566', 120).length).toBeLessThanOrEqual(30)
  })

  it('cuotas distintas dan referencias distintas', () => {
    expect(referenciaCargo('abc', 1)).not.toBe(referenciaCargo('abc', 2))
  })
})
