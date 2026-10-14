/**
 * Capa de proveedor (F5-5): ausente = Siigo (ningún espacio cambia); Aliaddo existe como lugar y
 * nunca emite a medias; un valor desconocido no cae a Siigo en silencio.
 */
import { describe, expect, it, vi } from 'vitest'

const emitirFacturaNegocio = vi.fn(async () => ({ ok: false, motivo: 'error', mensaje: 'doble' }))
const emitirReciboDeCobro = vi.fn(async () => ({ ok: false, motivo: 'error', mensaje: 'doble' }))
vi.mock('@/lib/siigo/facturas', () => ({ emitirFacturaNegocio }))
vi.mock('@/lib/siigo/recibos', () => ({ emitirReciboDeCobro }))

const { nombreDelProveedor, proveedorDeFacturacion } = await import('./proveedor')

describe('proveedor de facturación', () => {
  it('ausente o vacío = Siigo', () => {
    expect(nombreDelProveedor(null)).toBe('siigo')
    expect(nombreDelProveedor({})).toBe('siigo')
    expect(nombreDelProveedor({ facturacion_proveedor: '' })).toBe('siigo')
  })

  it('un valor desconocido se rechaza, no cae a Siigo', () => {
    expect(nombreDelProveedor({ facturacion_proveedor: 'alegra' })).toBeNull()
    expect(proveedorDeFacturacion({ facturacion_proveedor: 'alegra' })).toEqual({ error: expect.any(String) })
  })

  it('el adaptador de Siigo envuelve lo que ya existe', async () => {
    const p = proveedorDeFacturacion({})
    if ('error' in p) throw new Error('sin proveedor')
    await p.emitirFactura({ workspaceId: 'ws', negocioId: 'n', staffNombre: 'Diana', staffId: 's', opciones: { emitir: true } })
    expect(emitirFacturaNegocio).toHaveBeenCalledWith('ws', 'n', 'Diana', { emitir: true }, { staffId: 's' })
    await p.emitirRecibo({ workspaceId: 'ws', cobroId: 'c', staffNombre: null, opciones: {} })
    expect(emitirReciboDeCobro).toHaveBeenCalledWith('ws', 'c', null, {})
  })

  it('Aliaddo todavía no emite: lo dice', async () => {
    const p = proveedorDeFacturacion({ facturacion_proveedor: 'aliaddo' })
    if ('error' in p) throw new Error('sin proveedor')
    expect(p.disponible).toBe(false)
    expect(await p.emitirFactura({ workspaceId: 'ws', negocioId: 'n', staffNombre: null, staffId: null, opciones: { emitir: true } }))
      .toMatchObject({ ok: false, mensaje: expect.stringContaining('Aliaddo') })
  })
})
