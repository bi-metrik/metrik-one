import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))

import { FROM_FACTURACION } from './send-cuenta-cobro'
import { remitenteViajero } from '@/lib/viaje/correo-viajero'
import { remitente as remitenteAutorizacion } from '@/lib/autorizacion-datos/servidor'
import { marcaVacia } from '@/lib/marca/marca-workspace'

const CLAVE_SOENA = { remitente_correo: { nombre: 'SOENA', direccion: 'avisos@soena.metrikone.co' } }
const CLAVE_MALA = { remitente_correo: { nombre: 'SOENA', direccion: 'avisos@gruposoena.com' } }

describe('cuentas de cobro', () => {
  it('salen de facturacion@metrik.com.co (decisión 2026-05-19, spec original)', () => {
    expect(FROM_FACTURACION).toBe('MéTRIK · Facturación <facturacion@metrik.com.co>')
  })
})

describe('correo al viajero', () => {
  afterEach(() => vi.restoreAllMocks())

  it('sin la clave, el remitente de siempre', () => {
    expect(remitenteViajero('Trappvel', null)).toBe('Trappvel vía MéTRIK ONE <noreply@metrikone.co>')
    expect(remitenteViajero('  ', {})).toBe('Tu agencia vía MéTRIK ONE <noreply@metrikone.co>')
  })

  it('con la clave válida, el remitente del workspace', () => {
    expect(remitenteViajero('Trappvel', CLAVE_SOENA)).toBe('SOENA <avisos@soena.metrikone.co>')
  })

  it('con la clave en dominio no permitido, el de siempre y un error en el log', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(remitenteViajero('Trappvel', CLAVE_MALA)).toBe('Trappvel vía MéTRIK ONE <noreply@metrikone.co>')
    expect(espia).toHaveBeenCalledOnce()
  })
})

describe('correo de autorización de datos', () => {
  afterEach(() => vi.restoreAllMocks())
  const marca = { ...marcaVacia('AGENCIA S.A.S.'), nombreComercial: 'Agencia' }

  it('sin la clave, el remitente de siempre', () => {
    expect(remitenteAutorizacion(marca)).toBe('Agencia vía MéTRIK ONE <noreply@metrikone.co>')
    expect(remitenteAutorizacion(marca, { autorizacion_datos: {} })).toBe('Agencia vía MéTRIK ONE <noreply@metrikone.co>')
  })

  it('con la clave válida, el remitente del workspace', () => {
    expect(remitenteAutorizacion(marca, CLAVE_SOENA)).toBe('SOENA <avisos@soena.metrikone.co>')
  })

  it('con la clave en dominio no permitido, el de siempre', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(remitenteAutorizacion(marca, CLAVE_MALA)).toBe('Agencia vía MéTRIK ONE <noreply@metrikone.co>')
  })
})
