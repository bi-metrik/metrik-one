import { describe, expect, it } from 'vitest'
import { esCampoNit, normalizarFecha, normalizarNumero, validarFormatoCampo } from './formato-campo'
import type { CampoExtraccion } from '@/lib/ai/extract-fields'

const campo = (c: Partial<CampoExtraccion>): CampoExtraccion => ({
  slug: 'x', label: 'Campo', tipo: 'texto', required: true, descripcion_ai: '', ...c,
})

describe('normalizarFecha · las formas que la gente escribe (medidas en SOENA)', () => {
  it.each([
    ['2026-03-17', '2026-03-17'],
    [' 2023-07-15 11:16:00', '2023-07-15'],
    ['14/08/2026', '2026-08-14'],
    ['9/07/2026', '2026-07-09'],
    ['21/9/26', '2026-09-21'],
    ['30-9-26', '2026-09-30'],
    ['24 septiembre 2026', '2026-09-24'],
    ['24 de septiembre de 2026', '2026-09-24'],
  ])('«%s» → %s', (t, esperado) => expect(normalizarFecha(t)).toBe(esperado))

  it.each(['1', '0', '2026', '31/02/2026', '2026-13-01', '24 sepiembre 2026', 'mañana'])(
    '«%s» no es una fecha', t => expect(normalizarFecha(t)).toBeNull(),
  )
})

describe('normalizarNumero', () => {
  it.each([
    ['154.990.000,00', '154990000'],
    ['$1.500.000', '1500000'],
    ['1', '1'],
    ['12,5', '12.5'],
    ['80942857', '80942857'],
  ])('«%s» → %s', (t, esperado) => expect(normalizarNumero(t)).toBe(esperado))
  it.each(['uno', '1a', '$', '1.2.3,4,5'])('«%s» no es un número', t => expect(normalizarNumero(t)).toBeNull())
})

describe('esCampoNit', () => {
  it.each(['nit', 'nit_proveedor', 'emisor_nit', 'nit_completo'])('%s sí', s => expect(esCampoNit(s)).toBe(true))
  it.each(['dv', 'unit_price', 'nitido', 'numero_factura'])('%s no', s => expect(esCampoNit(s)).toBe(false))
})

describe('validarFormatoCampo', () => {
  it('vacío pasa: borrar un campo es legítimo', () => {
    expect(validarFormatoCampo(campo({ tipo: 'fecha' }), '  ')).toEqual({ ok: true, valor: '' })
  })

  it('los rellenos de SOENA no pasan', () => {
    expect(validarFormatoCampo(campo({ slug: 'fecha_factura', tipo: 'fecha' }), '1').ok).toBe(false)
    expect(validarFormatoCampo(campo({ slug: 'nit_proveedor' }), '1').ok).toBe(false)
    expect(validarFormatoCampo(campo({ slug: 'numero_factura', min_caracteres: 3 }), '0').ok).toBe(false)
    expect(validarFormatoCampo(campo({ slug: 'partida_arancelaria', valor_fijo: '0000' }), 'X').ok).toBe(false)
  })

  it('lo legítimo de un carácter sigue pasando donde no hay regla (dv, cantidad, otros_nombres)', () => {
    expect(validarFormatoCampo(campo({ slug: 'dv' }), '1')).toEqual({ ok: true, valor: '1' })
    expect(validarFormatoCampo(campo({ slug: 'cantidad', tipo: 'numero' }), '1')).toEqual({ ok: true, valor: '1' })
    expect(validarFormatoCampo(campo({ slug: 'otros_nombres' }), '-')).toEqual({ ok: true, valor: '-' })
  })

  it('normaliza fecha y número; el NIT con formato pasa', () => {
    expect(validarFormatoCampo(campo({ tipo: 'fecha' }), '17/03/2026')).toEqual({ ok: true, valor: '2026-03-17' })
    expect(validarFormatoCampo(campo({ tipo: 'currency' }), '$80.942.857')).toEqual({ ok: true, valor: '80942857' })
    expect(validarFormatoCampo(campo({ slug: 'nit_proveedor' }), '800.218.155-2')).toEqual({ ok: true, valor: '800.218.155-2' })
  })

  it('el mensaje nombra el campo', () => {
    const r = validarFormatoCampo(campo({ label: 'NIT del proveedor', slug: 'nit_proveedor' }), '1')
    expect(r).toEqual({ ok: false, mensaje: 'NIT del proveedor: un NIT tiene al menos 6 dígitos' })
  })
})
