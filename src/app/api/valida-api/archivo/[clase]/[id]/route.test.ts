/**
 * La descarga de recibos del módulo Valida API también exige la entrada aprobada.
 *
 * La pestaña Pagos no se pinta sin la aprobación única, pero la URL de descarga se puede escribir
 * a mano: sin la aprobación responde 403 y NO pregunta nada a las RPC del contrato ni firma una
 * URL del bucket.
 *
 * La clase `documento` (el PDF de los términos) se retiró con la pestaña Documentos: responde 404
 * aunque la entrada esté aprobada, y tampoco consulta ni firma nada.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const COBRO_ID = 'b91b4a14-cce1-4cfa-88d5-f235aa9e1060'
const SERVICIO_ID = '5d6f0a2e-7a55-4a4e-9a0b-6f1d2f3c4b5a'

const escenario = { aprobada: false }
const rpc = vi.fn()
const firmar = vi.fn()

vi.mock('@/lib/valida-api/contexto', () => ({
  contextoValidaApi: async () => ({
    tipo: 'ok',
    workspaceId: '64010015-a9a2-4aca-be83-e456cf217d96',
    userId: '123fc989-2520-4128-9e52-3283a524a75d',
    role: 'owner',
    clienteId: '8c211c68-6c25-4beb-b364-c91c284d6379',
    actor: { usuario_id: '123fc989-2520-4128-9e52-3283a524a75d', email: 'juan@4dsoft.co' },
  }),
}))
vi.mock('@/lib/valida-api/entrada-servidor', () => ({ entradaAprobada: async () => escenario.aprobada }))
vi.mock('@/lib/actions/get-workspace', () => ({ getWorkspace: async () => ({ supabase: { rpc } }) }))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ storage: { from: () => ({ createSignedUrl: firmar }) } }),
}))

const { GET } = await import('./route')

const pedir = (clase: string) =>
  GET(new Request(`https://4d-soft.metrikone.co/api/valida-api/archivo/${clase}/${COBRO_ID}`), {
    params: Promise.resolve({ clase, id: COBRO_ID }),
  })

beforeEach(() => {
  escenario.aprobada = false
  rpc.mockReset()
  rpc.mockImplementation(async (nombre: string) =>
    nombre === 'mis_servicios'
      ? { data: [{ servicio_contratado_id: SERVICIO_ID, es_pagador: true }], error: null }
      : { data: [{ cobro_id: COBRO_ID, recibo_path: 'recibos/rc-1.pdf', recibo_numero: 'RC-1' }], error: null },
  )
  firmar.mockReset()
  firmar.mockResolvedValue({ data: { signedUrl: 'https://firmada.example/rc-1.pdf' }, error: null })
})

describe('descarga de archivos del módulo', () => {
  it('sin la entrada aprobada, 403 y nada se consulta ni se firma', async () => {
    const r = await pedir('recibo')
    expect(r.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
    expect(firmar).not.toHaveBeenCalled()
  })

  it('con la entrada aprobada, el recibo se entrega por URL firmada', async () => {
    escenario.aprobada = true
    const r = await pedir('recibo')
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('https://firmada.example/rc-1.pdf')
  })

  it('el PDF de los términos ya no se sirve: 404, sin consultar ni firmar', async () => {
    escenario.aprobada = true
    const r = await pedir('documento')
    expect(r.status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
    expect(firmar).not.toHaveBeenCalled()
  })
})
