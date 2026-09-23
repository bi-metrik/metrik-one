/**
 * El «recaudo UPME» de la cola de facturación sale del comprobante de pago, y ese
 * valor puede llegar escrito con punto de miles.
 *
 * Se leía con `Number(v.replace(/[^\d.-]/g, ''))`, que conserva el punto: «$ 350.906»
 * salía como 350,906 pesos y la tarjeta mostraba «recaudo UPME $ 351». Ahora pasa por
 * el normalizador único de montos (`parseMontoCop`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WS, estado, reiniciarDoble, sembrar, servicioFalso } from '../../../test/cola-facturacion-doble'

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))

vi.mock('./get-workspace', () => ({
  getWorkspace: async () => ({
    workspaceId: WS, staffId: 'staff-diana', role: 'owner', areas: ['financiera'], supabase: null,
  }),
}))

vi.mock('@/lib/siigo/client', () => ({ siigoRequest: async () => ({ results: [] }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { getColaFacturacion } from './facturacion-actions'

beforeEach(reiniciarDoble)

/** Reescribe el valor pagado del comprobante UPME de cada caso sembrado. */
function valorPagadoUpme(valor: (i: number) => unknown) {
  let i = 0
  for (const fila of estado.fixtures.negocio_bloques) {
    if ((fila.bloque_configs as { slug: string | null }).slug !== 'comprobante_pago_upme') continue
    fila.data = { campos: { valor_pagado: { value: valor(i++) } } }
  }
}

describe('cola de facturación — el valor pagado a la UPME', () => {
  it('el punto de miles se lee como miles', async () => {
    sembrar({ casos: 3 })
    valorPagadoUpme(i => ['$ 350.906', '350.906', '1.234.567,89'][i])
    const { data, error } = await getColaFacturacion()
    expect(error).toBeUndefined()
    const porCodigo = Object.fromEntries(data!.casos.map(c => [c.codigo, c.valor_upme]))
    expect(porCodigo.V0000).toBe(350906)
    expect(porCodigo.V0001).toBe(350906)
    expect(porCodigo.V0002).toBeCloseTo(1234567.89, 2)
  })

  // CONTROL: lo que deja el extractor (número o texto sin separadores) no cambia.
  it('el valor limpio entra igual que antes', async () => {
    sembrar({ casos: 2 })
    valorPagadoUpme(i => [701812, '701812'][i])
    const { data } = await getColaFacturacion()
    const porCodigo = Object.fromEntries(data!.casos.map(c => [c.codigo, c.valor_upme]))
    expect(porCodigo).toEqual({ V0000: 701812, V0001: 701812 })
  })

  it('sin un valor legible no hay recaudo UPME', async () => {
    sembrar({ casos: 2 })
    valorPagadoUpme(i => ['', 'pendiente'][i])
    const { data } = await getColaFacturacion()
    const porCodigo = Object.fromEntries(data!.casos.map(c => [c.codigo, c.valor_upme]))
    expect(porCodigo).toEqual({ V0000: null, V0001: null })
  })
})
