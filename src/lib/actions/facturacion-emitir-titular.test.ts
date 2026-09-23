/**
 * La acción de servidor que factura valida el titular ANTES de tocar nada.
 *
 * Es una puerta pública: la pantalla valida con la misma regla, pero un DV que no cuadra
 * o un número con letras que llegara por aquí sería facturarle a otra persona. Y si el
 * negocio ya estaba facturado, el mensaje dice que la corrección NO se aplicó.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { calcularDvNit } from '@/lib/dian/nit'

let llamadasEmision: Array<{ datos?: Record<string, unknown> }>
let resultadoEmision: Record<string, unknown>

function servicioFalso() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { linea_id: null }, error: null }),
    maybeSingle: async () => ({ data: { full_name: 'Diana Parra' }, error: null }),
  }
  return { from: () => chain }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))
vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: 'ws-soena', staffId: 'staff-diana', role: 'owner', areas: ['financiera'], supabase: null,
  }),
}))
vi.mock('@/lib/negocios/negocio-abierto', () => ({ bloqueoPorNegocioCerrado: async () => null }))
vi.mock('@/lib/activity/registrar-actividad', () => ({ registrarActividad: async () => ({ ok: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/siigo/facturas', async () => {
  const real = await vi.importActual<typeof import('@/lib/siigo/facturas')>('@/lib/siigo/facturas')
  return {
    ...real,
    emitirFacturaNegocio: async (_ws: string, _neg: string, _nombre: string, opciones: { datos?: Record<string, unknown> }) => {
      llamadasEmision.push(opciones)
      return resultadoEmision
    },
  }
})

import { emitirFacturaDeNegocio } from './facturacion-actions'

beforeEach(() => {
  llamadasEmision = []
  resultadoEmision = {
    ok: true, numero: 'FV-2-700', siigo_id: 'x', total: 1, emitida: true, archivada: true,
    abonos: { emitidos: [], a_mano: [], fallidos: [] },
  }
})

describe('emitirFacturaDeNegocio — el titular se valida en el servidor', () => {
  it('un NIT con el DV equivocado se rechaza y no se emite nada', async () => {
    const malo = String((Number(calcularDvNit('900123456')) + 1) % 10)
    const r = await emitirFacturaDeNegocio('neg-1', {
      datos: { titular: { tipo_documento: '31', numero: '900123456', dv: malo, razon_social: 'ACME SAS' } },
    })
    expect(r.ok).toBe(false)
    expect(llamadasEmision).toHaveLength(0)
  })

  it('un titular válido viaja YA NORMALIZADO a la emisión', async () => {
    await emitirFacturaDeNegocio('neg-1', {
      datos: { titular: { tipo_documento: '13', numero: '52.100.200', nombres: ' Paula Andrea', apellidos: 'Oliveros ' } },
    })
    expect(llamadasEmision).toHaveLength(1)
    expect(llamadasEmision[0].datos?.titular).toEqual({
      tipo_documento: '13', numero: '52100200', dv: calcularDvNit('52100200'), nombre: ['Paula Andrea', 'Oliveros'],
    })
  })

  it('sin titular, no viaja ninguno', async () => {
    await emitirFacturaDeNegocio('neg-1', { datos: { email: 'a@b.co' } })
    expect(llamadasEmision[0].datos).not.toHaveProperty('titular')
  })

  it('ya facturado: el mensaje dice que la corrección NO se aplicó', async () => {
    resultadoEmision = { ok: false, motivo: 'ya_facturado_en_one', numero: 'FV-2-542' }
    const r = await emitirFacturaDeNegocio('neg-1', {
      datos: { titular: { tipo_documento: '13', numero: '52100200', nombres: 'PAULA', apellidos: 'OLIVEROS' } },
    })
    expect(r).toMatchObject({ ok: false })
    expect(r.error).toContain('FV-2-542')
    expect(r.error).toContain('la corrección del titular no se aplicó')
  })
})
