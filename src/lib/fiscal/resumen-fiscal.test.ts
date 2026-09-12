import { describe, it, expect } from 'vitest'
import { generarResumenFiscal, calcularSeguridadSocial } from './calculos-fiscales'
import type { FiscalProfile, Client } from '@/types/database'

/**
 * El bloque "el cliente paga / tú recibes" del editor de cotización repetía la
 * misma cifra en los dos renglones: el IVA se contaba como ingreso propio. De
 * ahí salía un margen neto MAYOR al margen de la cotización, que es imposible.
 */

const perfilSAS = {
  is_complete: true,
  person_type: 'persona_juridica',
  tax_regime: 'ordinario',
  iva_responsible: true,
  is_declarante: true,
  self_withholder: false,
  ica_city: '',
} as unknown as FiscalProfile

const clienteSinRetener = {
  person_type: 'persona_juridica',
  tax_regime: 'ordinario',
  gran_contribuyente: false,
  agente_retenedor: false,
} as unknown as Client

describe('resumen fiscal: el IVA no es plata del vendedor', () => {
  // Los números reales de COT-2026-0003 de Termotech.
  const precio = 153_655_469
  const costo = 123_925_695

  it('el cliente paga la base más el IVA', () => {
    const r = generarResumenFiscal(perfilSAS, clienteSinRetener, precio, costo)
    expect(r.iva).toBe(Math.round(precio * 0.19))
    expect(r.total_paga_cliente).toBe(precio + r.iva)
  })

  it('sin retenciones, lo que le queda es la base: NO lo que pagó el cliente', () => {
    const r = generarResumenFiscal(perfilSAS, clienteSinRetener, precio, costo)
    expect(r.neto_recibido).toBe(precio)
    expect(r.neto_recibido).toBeLessThan(r.total_paga_cliente)
    expect(r.iva_trasladado).toBe(r.iva)
  })

  it('el margen neto nunca supera al margen de la cotización', () => {
    const r = generarResumenFiscal(perfilSAS, clienteSinRetener, precio, costo)
    const margenCotizacion = ((precio - costo) / precio) * 100
    expect(r.margen_real_neto_pct).toBeLessThanOrEqual(Math.ceil(margenCotizacion))
    expect(r.ganancia_real).toBe(precio - costo)
  })

  it('a una empresa no se le cobra la seguridad social del independiente', () => {
    const r = generarResumenFiscal(perfilSAS, clienteSinRetener, precio, costo)
    expect(r.seguridad_social).toBe(0)
  })

  it('a la persona natural sí se le provisiona seguridad social', () => {
    const perfilPN = { ...perfilSAS, person_type: 'persona_natural' } as unknown as FiscalProfile
    const r = generarResumenFiscal(perfilPN, clienteSinRetener, precio, costo)
    expect(r.seguridad_social).toBeGreaterThan(0)
    expect(r.ganancia_real).toBe(precio - costo - r.seguridad_social)
  })

  it('las retenciones de renta e ICA sí bajan la caja; el reteIVA no, va contra el IVA ajeno', () => {
    const clienteRetenedor = { ...clienteSinRetener, agente_retenedor: true } as unknown as Client
    const r = generarResumenFiscal(perfilSAS, clienteRetenedor, precio, costo)
    expect(r.neto_recibido).toBe(precio - r.retefuente_valor - r.reteica_valor)
  })
})

describe('calcularSeguridadSocial', () => {
  it('sin tipo de persona declarado, provisiona: el caso viejo era persona natural', () => {
    expect(calcularSeguridadSocial(1_000_000)).toBeGreaterThan(0)
  })

  it('persona jurídica no provisiona', () => {
    expect(calcularSeguridadSocial(1_000_000, 'persona_juridica')).toBe(0)
  })
})
