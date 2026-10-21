/**
 * El PDF del cierre de obra imprime lo que dice la vista: la utilidad «hasta hoy» mientras la obra
 * anda (con el aviso de gastos faltantes), los rubros, la mano de obra con sus jornadas, lo
 * facturado/cobrado/retenido y las facturas. Se afirma sobre el texto del binario, no sobre las props.
 */
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'

import CierreObraPDF, { type CierreObraPDFProps } from './cierre-obra-pdf'
import { textoDelPDF } from './texto-del-pdf'
import { resumirCierre, type FilaCierreObra } from '@/lib/obras/cierre'

const fila: FilaCierreObra = {
  negocio_id: 'n1',
  codigo: 'X1 26 5',
  nombre: 'Edificio de prueba',
  nombre_corto: 'Prueba',
  estado: 'abierto',
  empresa_id: null,
  vendido: 48000000,
  gastos_por_rubro: [{ rubro: 'Materiales de obra', total: 14320000 }],
  gastos_total: 14320000,
  mano_obra: 5320000,
  jornadas: 38,
  jornadas_sin_valor: 2,
  utilidad: 28360000,
  facturado: 25000000,
  cobrado: 24000000,
  retenido: 1000000,
  saldo_facturas: 0,
  por_cobrar: 23000000,
}

const props = (p: Partial<FilaCierreObra> = {}): CierreObraPDFProps => ({
  marca: { nombre: 'Constructora Inventada', logo_url: null, color_primario: '#123456' },
  obra: { codigo: 'X1 26 5', nombre: 'Edificio de prueba', cliente: 'Cliente Inventado' },
  fecha: '2026-10-21',
  cierre: resumirCierre({ ...fila, ...p }),
  facturas: [
    {
      id: 'f1',
      negocio_id: 'n1',
      empresa_id: null,
      numero_factura: 'FE-231',
      fecha_emision: '2026-10-15',
      monto: 25000000,
      estado: 'pagada',
      pagada_at: '2026-10-20T15:00:00Z',
      recibido: 24000000,
      saldo_pendiente: null,
      retenido: 1000000,
    },
  ],
})

const render = async (p: CierreObraPDFProps) =>
  textoDelPDF(Buffer.from(await renderToBuffer(createElement(CierreObraPDF, p) as Parameters<typeof renderToBuffer>[0])))

describe('PDF del cierre de obra', () => {
  it('obra en curso: utilidad hasta hoy, rubros, jornadas, facturas y avisos', async () => {
    const t = await render(props())
    expect(t).toContain('Constructora Inventada')
    expect(t).toContain('Utilidad hasta hoy')
    expect(t).toContain('$28.360.000')
    expect(t).toContain('59 %')
    expect(t).toContain('Materiales de obra')
    expect(t).toContain('38 jornadas')
    expect(t).toContain('FE-231')
    expect(t).toContain('$1.000.000')
    expect(t).toContain('Faltan los gastos')
    expect(t).toContain('2 llegadas sin valor')
    expect(t).toContain('No es un certificado')
  }, 30_000)

  it('obra cerrada: «Utilidad» sin el aviso de gastos faltantes', async () => {
    const t = await render(props({ estado: 'completado' }))
    expect(t).toContain('Obra cerrada')
    expect(t).not.toContain('hasta hoy')
    expect(t).not.toContain('Faltan los gastos')
  }, 30_000)
})
