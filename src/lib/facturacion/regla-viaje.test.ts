/**
 * Cuándo entra a la cola un viaje (Vera C4, F5-1) y el «desde» por línea (Max §7, Q5).
 * Decide un documento fiscal: cada guarda se probó quitándola (mutación) y alguna prueba cae.
 */
import { describe, expect, it } from 'vitest'
import {
  configFacturacionLinea,
  desdePorLinea,
  entraALaColaViaje,
  hayReglaDeCola,
  paqueteEnviado,
  pildoraFactura,
  tipoDeTitular,
  type EstadoViajeParaFactura,
} from './regla-viaje'

const base: EstadoViajeParaFactura = { titular: { tipo_documento: '13' }, confirmado: true, paqueteEnviado: false, saldo: 500_000, forzada: false }

describe('configFacturacionLinea', () => {
  it('ausente: activa, sin desde, sin regla del viaje', () => {
    expect(configFacturacionLinea(null)).toEqual({ activo: true, desde: null, porTitular: false })
  })
  it('lee desde, activo y por_titular', () => {
    expect(configFacturacionLinea({ facturacion: { desde_etapa_numero: 5 } })).toEqual({ activo: true, desde: 5, porTitular: false })
    expect(configFacturacionLinea({ facturacion: { activo: false, por_titular: { activo: true } } })).toEqual({ activo: false, desde: null, porTitular: true })
    expect(configFacturacionLinea({ facturacion: { por_titular: { activo: false } } }).porTitular).toBe(false)
  })
})

describe('desdePorLinea', () => {
  it('cada línea con el suyo; sin valor hereda el primero; apagada o de viaje no tiene', () => {
    const m = desdePorLinea([
      { id: 'a', config_extra: { facturacion: { desde_etapa_numero: 5 } } },
      { id: 'b', config_extra: { facturacion: { desde_etapa_numero: 7 } } },
      { id: 'c', config_extra: {} },
      { id: 'd', config_extra: { facturacion: { desde_etapa_numero: 4, activo: false } } },
      { id: 'e', config_extra: { facturacion: { desde_etapa_numero: 4, por_titular: { activo: true } } } },
    ])
    expect([...m.entries()]).toEqual([['a', 5], ['b', 7], ['c', 5]])
  })
  it('sin ningún desde, ninguna línea entra por etapa', () => {
    expect(desdePorLinea([{ id: 'a', config_extra: {} }]).size).toBe(0)
  })
  it('hayReglaDeCola: por etapa o por viaje', () => {
    expect(hayReglaDeCola([{ id: 'a', config_extra: {} }])).toBe(false)
    expect(hayReglaDeCola([{ id: 'a', config_extra: { facturacion: { por_titular: { activo: true } } } }])).toBe(true)
    expect(hayReglaDeCola([{ id: 'a', config_extra: { facturacion: { por_titular: { activo: true }, activo: false } } }])).toBe(false)
  })
})

describe('entraALaColaViaje', () => {
  it('empresa: al confirmar, sin mirar el saldo ni el paquete', () => {
    const empresa = { ...base, titular: { tipo_documento: '31' } }
    expect(entraALaColaViaje(empresa)).toEqual({ entra: true, motivo: 'empresa_confirmada' })
    expect(entraALaColaViaje({ ...empresa, confirmado: false })).toEqual({ entra: false, motivo: null })
  })
  it('persona: paquete enviado Y saldo en cero', () => {
    expect(entraALaColaViaje(base).entra).toBe(false)
    expect(entraALaColaViaje({ ...base, paqueteEnviado: true }).entra).toBe(false)
    expect(entraALaColaViaje({ ...base, saldo: 0 }).entra).toBe(false)
    expect(entraALaColaViaje({ ...base, paqueteEnviado: true, saldo: 0 })).toEqual({ entra: true, motivo: 'persona_entregada' })
    expect(entraALaColaViaje({ ...base, paqueteEnviado: true, saldo: 1 }).entra).toBe(true)
    expect(entraALaColaViaje({ ...base, paqueteEnviado: true, saldo: 2 }).entra).toBe(false)
  })
  it('forzada entra siempre', () => {
    expect(entraALaColaViaje({ ...base, confirmado: false, forzada: true })).toEqual({ entra: true, motivo: 'forzada' })
  })
  it('sin titular se trata como persona', () => {
    expect(tipoDeTitular(null)).toBe('persona')
    expect(entraALaColaViaje({ ...base, titular: null }).entra).toBe(false)
  })
})

describe('píldora (Noor, Riel B)', () => {
  it('textos por estado', () => {
    expect(pildoraFactura({ activa: false, estado: base, facturaNumero: null }).texto).toBe('Factura: no sale todavía')
    expect(pildoraFactura({ activa: true, estado: { ...base, titular: { tipo_documento: '31' }, confirmado: false }, facturaNumero: null }).texto).toBe('Factura: al confirmar (empresa)')
    expect(pildoraFactura({ activa: true, estado: base, facturaNumero: null }).texto).toBe('Factura: cuando entregues el paquete y el saldo esté en cero')
    expect(pildoraFactura({ activa: true, estado: { ...base, forzada: true }, facturaNumero: null }).texto).toBe('Factura: en cola')
    expect(pildoraFactura({ activa: true, estado: base, facturaNumero: 'FE-2291' }).texto).toBe('Factura emitida FE-2291')
  })
  it('paquete enviado se lee de metadata.paquete_viaje.enviado_at (lo escribe F4)', () => {
    expect(paqueteEnviado({ paquete_viaje: { enviado_at: '2026-11-01T10:00:00Z' } })).toBe(true)
    expect(paqueteEnviado({ paquete_viaje: {} })).toBe(false)
    expect(paqueteEnviado(null)).toBe(false)
  })
})
