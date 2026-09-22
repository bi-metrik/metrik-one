/**
 * Las líneas que DESCRIBE el documento del cliente. Las usan dos caminos que tienen que
 * ver lo mismo: la acción del PDF y el redactor del texto para el cliente. Si se separan,
 * el texto describe un vuelo que el documento no imprime.
 */
import { describe, expect, it } from 'vitest'

import { aportaAlTotal, lineasQueDescribeElDocumento } from './lineas-del-documento'

const linea = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  grupo: null as string | null,
  opcion_de: null as string | null,
  es_ajuste: false,
  orden: 0,
  ...extra,
})

const COTIZACION = [
  linea('avianca', { grupo: 'vuelo', orden: 1 }),
  linea('wingo', { grupo: 'vuelo', orden: 2, opcion_de: 'avianca' }),
  linea('hotel', { grupo: 'hotel', orden: 3 }),
  linea('cuadre', { orden: 4, es_ajuste: true }),
]

describe('lineasQueDescribeElDocumento', () => {
  it('⚠️ sin itinerario principal, una alternativa descartada no se describe', () => {
    const ids = lineasQueDescribeElDocumento(COTIZACION, null).map(l => l.id)
    expect(ids).toContain('avianca')
    expect(ids).toContain('hotel')
    expect(ids).not.toContain('wingo')
  })

  it('el ítem de cuadre entra siempre: su rama vive fuera de las ranuras', () => {
    expect(aportaAlTotal(COTIZACION)(COTIZACION[3])).toBe(true)
  })

  it('con itinerario principal, sus líneas y en su orden', () => {
    const ids = lineasQueDescribeElDocumento(COTIZACION, ['hotel', 'wingo']).map(l => l.id)
    expect(ids).toEqual(['hotel', 'wingo'])
  })

  it('un id del principal que ya no existe se ignora, no rompe', () => {
    expect(lineasQueDescribeElDocumento(COTIZACION, ['hotel', 'borrada']).map(l => l.id)).toEqual(['hotel'])
  })
})
