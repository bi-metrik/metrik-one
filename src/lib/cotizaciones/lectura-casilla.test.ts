import { describe, expect, it } from 'vitest'

import { construirLecturaCasilla, mencionaPersonas } from './lectura-casilla'
import type { Aceptacion, CampoLeido } from './lectura-pantallazo'
import { ranuraPorSlug } from './ranuras-pantallazo'

const HOTEL = ranuraPorSlug('hotel_detalle')!
const VUELO = ranuraPorSlug('vuelo_detalle')!

function aceptacion(ranura: typeof HOTEL, valores: Record<string, string | null>, over: Partial<Aceptacion> = {}): Aceptacion {
  const campos: CampoLeido[] = ranura.campos.map(c => ({
    slug: c.slug,
    label: c.label,
    valor: valores[c.slug] ?? null,
    confidence: valores[c.slug] ? 1 : 0,
    alertaRevision: c.alerta_revision === true,
  }))
  return { ok: true, ranura: ranura.slug, campos, desglose: [], avisos: [], porTipoPax: [], totalGeneral: null, ...over }
}

describe('ocupación de un hotel: sin texto de personas no hay evidencia', () => {
  it('«1 x Standard Room AD» es número de habitaciones: los conteos se descartan (medido en Barcelona)', () => {
    const l = construirLecturaCasilla(HOTEL, aceptacion(HOTEL, {
      hotel: 'NH Barcelona Eixample', moneda: 'COP', precio_total: '1628152.74', base_precio: 'total',
      ocupacion: '1 x Standard Room AD', ocupacion_adultos: '1', ocupacion_ninos: '0', ocupacion_infantes: '0', ocupacion_total: '1',
    }), '2026-09-16T00:00:00Z')
    expect(l.ocupacionDelItem).toBe(true)
    expect(l.ocupacion).toEqual({ adultos: null, ninos: null, infantes: null, total: null })
  })

  it('«2 Adultos - 1 Niño» sí es evidencia (Bedsonline Cancún)', () => {
    const l = construirLecturaCasilla(HOTEL, aceptacion(HOTEL, {
      hotel: 'Crown Paradise Club Cancun All Inclusive', moneda: 'COP', precio_total: '3780884.17', base_precio: 'total',
      ocupacion: '2 Adultos - 1 Niño', ocupacion_adultos: '2', ocupacion_ninos: '1',
      impuestos_destino_valor: '329.44', impuestos_destino_moneda: 'MXN',
    }), '2026-09-16T00:00:00Z')
    expect(l.ocupacion).toEqual({ adultos: 2, ninos: 1, infantes: 0, total: null })
    expect(l.total).toBe(3780884.17)
    expect(l.notasCliente).toEqual(['Impuestos y tasas a pagar en destino: 329,44 MXN, no incluidos en el precio.'])
  })

  it('las palabras que cuentan', () => {
    expect(mencionaPersonas('3 Huéspedes')).toBe(true)
    expect(mencionaPersonas('2 adultos + 1 menor')).toBe(true)
    expect(mencionaPersonas('1 x Double Or Twin St...')).toBe(false)
    expect(mencionaPersonas(null)).toBe(false)
  })
})

describe('lectura con tabla por tipo de pasajero', () => {
  it('el total es el de la tabla y las filas del mismo tipo se suman', () => {
    const l = construirLecturaCasilla(VUELO, aceptacion(VUELO, { aerolinea: 'Avianca', moneda: 'COP', precio_total: '1294351', base_precio: 'total' }, {
      porTipoPax: [
        { tipo: 'adulto', cantidad: 1, subtotal_tipo: 641507, moneda: 'COP', confidence: 1 },
        { tipo: 'adulto', cantidad: 1, subtotal_tipo: 641507, moneda: 'COP', confidence: 1 },
        { tipo: 'infante', cantidad: 1, subtotal_tipo: 11337, moneda: 'COP', confidence: 1 },
      ],
      totalGeneral: 1294351,
    }), '2026-09-16T00:00:00Z')
    expect(l.total).toBe(1294351)
    expect(l.porTipo).toEqual([
      { tipo: 'adulto', cantidad: 2, subtotal: 1283014 },
      { tipo: 'infante', cantidad: 1, subtotal: 11337 },
    ])
  })

  it('un valor tomado del viaje NO es identidad para comparar capturas', () => {
    const a = aceptacion(HOTEL, { hotel: 'X', moneda: 'COP', precio_total: '10', base_precio: 'total', check_in: '2026-10-01', check_out: '2026-10-04' })
    for (const c of a.campos) if (c.slug === 'check_in' || c.slug === 'check_out') c.delItem = true
    const l = construirLecturaCasilla(HOTEL, a, '2026-09-16T00:00:00Z')
    expect(l.identidad.check_in).toBeNull()
    expect(l.identidad.hotel).toBe('X')
    expect(l.campos.find(c => c.label === 'Check-in')?.valor).toBe('2026-10-01 (del viaje)')
  })
})
