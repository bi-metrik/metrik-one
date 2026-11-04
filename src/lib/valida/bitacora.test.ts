import { describe, expect, it } from 'vitest'
import { celdasBitacora, ENCABEZADO_BITACORA, fechaHoraBogota, nombreArchivoBitacora } from './bitacora'

describe('la bitácora en XLSX (Términos del Plan CDA 9.3 y 11.2)', () => {
  const fila = {
    created_at: '2026-12-06T03:30:00+00:00',
    tipo: 'masiva_item',
    tipo_persona: 'natural',
    nombre_consultado: 'JUAN PEREZ',
    documento_tipo: 'CC',
    documento_numero: '1077089147',
    severidad: 'sin_hallazgo',
    total_matches: 0,
    valida_consulta_id: 'vc-1',
    hash_reporte: 'abc123',
    created_by: 'u-1',
    negocio_id: 'n-1',
  }

  it('una fila por consulta con la evidencia: fecha en Bogotá, datos, resultado, código y huella', () => {
    const usuarios = new Map([['u-1', 'Ana Gómez']])
    expect(celdasBitacora(fila, { usuarios, negocios: null })).toEqual([
      '2026-12-05 22:30',
      'Cargue',
      'natural',
      'JUAN PEREZ',
      'CC',
      '1077089147',
      'sin_hallazgo',
      0,
      'vc-1',
      'abc123',
      'Ana Gómez',
    ])
    expect(celdasBitacora(fila, { usuarios, negocios: null })).toHaveLength(ENCABEZADO_BITACORA.length)
  })

  it('con negocios (fuera del modo vitrina) agrega el código del negocio', () => {
    const c = celdasBitacora(fila, { usuarios: new Map(), negocios: new Map([['n-1', 'C1 26 1']]) })
    expect(c.at(-1)).toBe('C1 26 1')
    expect(c[10]).toBe('')
  })

  it('la hora de Bogotá cruza el día hacia atrás', () => {
    expect(fechaHoraBogota('2026-12-06T04:59:00Z')).toBe('2026-12-05 23:59')
    expect(fechaHoraBogota('2026-12-06T05:00:00Z')).toBe('2026-12-06 00:00')
  })

  it('el nombre del archivo lleva el espacio y el día', () => {
    expect(nombreArchivoBitacora('cda-caqueta', '2026-12-06')).toBe('valida-bitacora-cda-caqueta-2026-12-06.xlsx')
    expect(nombreArchivoBitacora(null, '2026-12-06')).toBe('valida-bitacora-2026-12-06.xlsx')
  })
})
