/**
 * La descarga de archivos del módulo Valida API también exige la entrada aprobada.
 *
 * La pestaña Documentos y la de Pagos no se pintan sin la aprobación única, pero la URL de
 * descarga se puede escribir a mano: sin la aprobación responde 403 y NO pregunta nada a las RPC
 * del contrato ni firma una URL del bucket.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const DOC_ID = 'b91b4a14-cce1-4cfa-88d5-f235aa9e1060'

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
  GET(new Request(`https://4d-soft.metrikone.co/api/valida-api/archivo/${clase}/${DOC_ID}`), {
    params: Promise.resolve({ clase, id: DOC_ID }),
  })

beforeEach(() => {
  escenario.aprobada = false
  rpc.mockReset()
  rpc.mockResolvedValue({
    data: [{ documento_id: DOC_ID, pdf_bucket: 'aceptaciones-documentos', pdf_path: 'x.pdf', slug: 'terminos-uso-valida', version: 'v1.0' }],
    error: null,
  })
  firmar.mockReset()
  firmar.mockResolvedValue({ data: { signedUrl: 'https://firmada.example/x.pdf' }, error: null })
})

describe('descarga de archivos del módulo', () => {
  it('sin la entrada aprobada, 403 y nada se consulta ni se firma', async () => {
    for (const clase of ['documento', 'recibo']) {
      const r = await pedir(clase)
      expect(r.status, clase).toBe(403)
    }
    expect(rpc).not.toHaveBeenCalled()
    expect(firmar).not.toHaveBeenCalled()
  })

  it('con la entrada aprobada, el documento se entrega por URL firmada', async () => {
    escenario.aprobada = true
    const r = await pedir('documento')
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('https://firmada.example/x.pdf')
  })
})
