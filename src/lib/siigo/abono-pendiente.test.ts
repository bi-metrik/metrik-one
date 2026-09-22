/**
 * `porQueNoSeAbona`: el criterio único de qué cobro pide abono a la factura.
 *
 * Lo comparten el abono al facturar, el abono al registrar un pago y el lote del rezago.
 * Si dos de ellos contestaran distinto, el lote contaría una cifra y el disparo automático
 * haría otra — que es justo lo que no se puede auditar después.
 */
import { describe, it, expect } from 'vitest'
import { porQueNoSeAbona } from './abono-pendiente'

const ctx = { honorario: 637_500, negocioConciliado: false, facturaVinculada: true }
const base = { siigo_recibo: null, recibo_no_aplica: null, split_json: null }

describe('porQueNoSeAbona', () => {
  it('un pago con honorario y sin nada emitido SÍ se abona', () => {
    expect(porQueNoSeAbona(base, ctx)).toBeNull()
  })

  it('sin reparto no es razón para saltarlo: la emisión lo reporta', () => {
    expect(porQueNoSeAbona(base, { ...ctx, honorario: null })).toBeNull()
  })

  it('el corte histórico no lleva abono retroactivo', () => {
    expect(porQueNoSeAbona({ ...base, recibo_no_aplica: { motivo: 'Negocio ya facturado' } }, ctx)).toBe('no_aplica')
  })

  it('un pago de pura tarifa no tiene honorario que abonar', () => {
    expect(porQueNoSeAbona(base, { ...ctx, honorario: 0 })).toBe('sin_honorario')
  })

  it('ya abonado, con anticipo de honorario o con una marca vieja por el total: no se toca', () => {
    const abono = [{ numero: 'RC-1-90', componente: 'honorario', tipo: 'abono' }]
    const anticipo = [{ numero: 'RC-1-80', componente: 'honorario' }]
    const total = { numero: 'RC-1-65' }
    expect(porQueNoSeAbona({ ...base, siigo_recibo: abono }, ctx)).toBe('ya_acusado')
    expect(porQueNoSeAbona({ ...base, siigo_recibo: anticipo }, ctx)).toBe('ya_acusado')
    expect(porQueNoSeAbona({ ...base, siigo_recibo: total }, ctx)).toBe('ya_acusado')
  })

  it('un RC-3 de la tarifa NO cuenta como abono del honorario', () => {
    const rc3 = [{ numero: 'RC-3-12', componente: 'pasante' }]
    expect(porQueNoSeAbona({ ...base, siigo_recibo: rc3 }, ctx)).toBeNull()
  })

  it('un «a mano» no se reintenta… salvo la factura sin vínculo, cuando ya lo tiene', () => {
    const aMano = (motivo: string) => [{ componente: 'honorario', abono_a_mano: { motivo, detalle: '' }, valor: 1 }]
    expect(porQueNoSeAbona({ ...base, siigo_recibo: aMano('retencion') }, ctx)).toBe('a_mano')
    expect(porQueNoSeAbona({ ...base, siigo_recibo: aMano('factura_sin_vinculo') }, { ...ctx, facturaVinculada: false }))
      .toBe('a_mano')
    expect(porQueNoSeAbona({ ...base, siigo_recibo: aMano('factura_sin_vinculo') }, ctx)).toBeNull()
  })

  it('una porción propuesta por el comercial espera a la financiera', () => {
    const propuesta = { ...base, split_json: { origen: 'comercial' } }
    expect(porQueNoSeAbona(propuesta, ctx)).toBe('por_confirmar')
    expect(porQueNoSeAbona({ ...base, split_json: { origen: 'comercial', confirmado_at: '2026-09-16' } }, ctx)).toBeNull()
    // El negocio conciliado vale como aceptación (lo aceptado antes de existir la marca).
    expect(porQueNoSeAbona(propuesta, { ...ctx, negocioConciliado: true })).toBeNull()
    // Un reparto de la financiera no se confirma a sí mismo.
    expect(porQueNoSeAbona({ ...base, split_json: { origen: 'redistribucion_financiera' } }, ctx)).toBeNull()
  })
})
