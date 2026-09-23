/**
 * Descargas de la pestaña Pagos de `/valida` de un CDA (factura PDF/XML de una cuota y recibo de un
 * pago). Se fija que la URL escrita a mano no entrega nada que la pestaña no mostraría:
 *   - sin los términos aceptados, o sin poder ver la plata, 403 y no se consulta ni se firma nada;
 *   - la autorización es la MISMA RPC que lista: una cuota que no está en `mis_cuotas_de_servicio`
 *     responde el mismo 404 que una que no existe;
 *   - lo que sí está sale como redirect a una URL firmada de 60 s, con el nombre de la factura.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const CUOTA = '55555555-5555-4555-8555-555555555555'
const OTRA = '66666666-6666-4666-8666-666666666666'
const COBRO = 'b91b4a14-cce1-4cfa-88d5-f235aa9e1060'
const SC = '44444444-4444-4444-8444-444444444444'

const escenario = { aprobada: true, vePagos: true }
const rpc = vi.fn()
const firmar = vi.fn()

vi.mock('@/lib/valida-cda/puerta', () => ({
  entradaValidaCda: async () => ({
    tipo: 'ok',
    workspaceId: 'b58e4b68-8bed-48b6-85f8-01995f64ffe6',
    usuarioId: '11111111-1111-4111-8111-111111111111',
    role: 'operator',
    estado: escenario.aprobada ? { estado: 'aprobada' } : { estado: 'pendiente' },
    hoy: '2026-10-05',
    servicioContratadoId: SC,
    plazoTerminos: null,
    enPlazo: false,
  }),
  puedeVerPagosCda: async () => escenario.vePagos,
}))
vi.mock('@/lib/actions/get-workspace', () => ({ getWorkspace: async () => ({ supabase: { rpc } }) }))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({ storage: { from: () => ({ createSignedUrl: firmar }) } }),
}))

const { GET } = await import('./route')

const pedir = (clase: string, id: string) =>
  GET(new Request(`https://cda-caqueta.metrikone.co/api/valida/archivo/${clase}/${id}`), {
    params: Promise.resolve({ clase, id }),
  })

beforeEach(() => {
  escenario.aprobada = true
  escenario.vePagos = true
  rpc.mockReset()
  rpc.mockImplementation(async (nombre: string) =>
    nombre === 'mis_cuotas_de_servicio'
      ? {
          data: [
            {
              cuota_id: CUOTA,
              factura_numero: 'FE-123',
              factura_pdf_path: 'ws/facturas/aaa.pdf',
              factura_xml_path: null,
            },
          ],
          error: null,
        }
      : { data: [{ cobro_id: COBRO, recibo_path: 'ws/recibos/rc.pdf', recibo_numero: 'RC-1' }], error: null },
  )
  firmar.mockReset()
  firmar.mockResolvedValue({ data: { signedUrl: 'https://firmada.example/x' }, error: null })
})

describe('descargas de la pestaña Pagos del CDA', () => {
  it('sin los términos aceptados, 403 y nada se consulta ni se firma', async () => {
    escenario.aprobada = false
    const r = await pedir('factura_pdf', CUOTA)
    expect(r.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
    expect(firmar).not.toHaveBeenCalled()
  })

  it('sin poder ver la plata (operador que no es la designada), 403', async () => {
    escenario.vePagos = false
    const r = await pedir('recibo', COBRO)
    expect(r.status).toBe(403)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('la factura listada sale firmada 60 s, con el número como nombre, pidiéndola al contrato del espacio', async () => {
    const r = await pedir('factura_pdf', CUOTA)
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('https://firmada.example/x')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(rpc).toHaveBeenCalledWith('mis_cuotas_de_servicio', { p_servicio_contratado_id: SC })
    expect(firmar).toHaveBeenCalledWith('ws/facturas/aaa.pdf', 60, { download: 'FE-123.pdf' })
  })

  it('una parte que no se cargó (el XML) y una cuota que no está en la lista: el mismo 404', async () => {
    expect((await pedir('factura_xml', CUOTA)).status).toBe(404)
    expect((await pedir('factura_pdf', OTRA)).status).toBe(404)
    expect(firmar).not.toHaveBeenCalled()
  })

  it('el recibo se autoriza con mis_cobros_de_servicio', async () => {
    const r = await pedir('recibo', COBRO)
    expect(r.status).toBe(302)
    expect(rpc).toHaveBeenCalledWith('mis_cobros_de_servicio', { p_servicio_contratado_id: SC })
    expect(firmar).toHaveBeenCalledWith('ws/recibos/rc.pdf', 60, { download: 'RC-1.pdf' })
  })

  it('una clase inventada o un id que no es uuid: 404 sin consultar', async () => {
    expect((await pedir('documento', CUOTA)).status).toBe(404)
    expect((await pedir('factura_pdf', 'x')).status).toBe(404)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('si la RPC falla, 503: no se confunde con «no existe»', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'caída' } })
    expect((await pedir('factura_pdf', CUOTA)).status).toBe(503)
  })
})
