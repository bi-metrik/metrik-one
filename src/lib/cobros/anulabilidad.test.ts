import { describe, it, expect } from 'vitest'
import {
  esCuotaDePlan,
  esFuentePasarela,
  evaluarAnulabilidad,
  type CobroParaAnular,
} from './anulabilidad'

const libre: CobroParaAnular = { tipo_cobro: 'externo', fuente: 'davivienda' }
const sinCC = { enCuentaCobroEmitida: false }

describe('evaluarAnulabilidad', () => {
  it('el caso que motivo el cambio: un anticipo registrado a mano SE PUEDE anular', () => {
    // 101 de los 111 cobros de SOENA son de esta forma (anticipo/pago, fuente null).
    // Antes quedaban fuera solo por no ser tipo_cobro='externo'.
    const v = evaluarAnulabilidad({ tipo_cobro: 'anticipo', fuente: null }, sinCC)
    expect(v.anulable).toBe(true)
  })

  it('un pago externo sigue siendo anulable (no se rompe lo que ya funcionaba)', () => {
    expect(evaluarAnulabilidad(libre, sinCC).anulable).toBe(true)
  })

  it('un cobro de la pasarela NO se anula: la transaccion vive en ePayco', () => {
    const v = evaluarAnulabilidad({ tipo_cobro: 'anticipo', fuente: 'epayco' }, sinCC)
    expect(v.anulable).toBe(false)
    if (!v.anulable) {
      expect(v.motivo).toBe('pasarela')
      // El mensaje dice a donde ir, no solo que no se puede.
      expect(v.error).toContain('redistribuyendo')
    }
  })

  it('la fuente de pasarela se reconoce con mayusculas y espacios', () => {
    expect(esFuentePasarela(' ePayco ')).toBe(true)
    expect(esFuentePasarela('EPAYCO')).toBe(true)
  })

  it('davivienda NO es pasarela: es el banco de una transferencia registrada a mano', () => {
    expect(esFuentePasarela('davivienda')).toBe(false)
    expect(esFuentePasarela(null)).toBe(false)
    expect(esFuentePasarela('')).toBe(false)
  })

  it('una cuota de plan NO se anula por aqui, ni por tipo ni por vinculo', () => {
    const porTipo = evaluarAnulabilidad({ tipo_cobro: 'programado' }, sinCC)
    const porVinculo = evaluarAnulabilidad({ tipo_cobro: 'pago', plan_cobro_id: 'plan-1' }, sinCC)
    expect(porTipo.anulable).toBe(false)
    expect(porVinculo.anulable).toBe(false)
    if (!porVinculo.anulable) expect(porVinculo.motivo).toBe('cuota_de_plan')
    expect(esCuotaDePlan({ tipo_cobro: 'pago', plan_cobro_id: null })).toBe(false)
  })

  it('un cobro dentro de una cuenta de cobro emitida NO se anula: desarma su soporte', () => {
    const v = evaluarAnulabilidad(libre, { enCuentaCobroEmitida: true })
    expect(v.anulable).toBe(false)
    if (!v.anulable) expect(v.motivo).toBe('cuenta_cobro_emitida')
  })

  it('un cobro ya anulado no se vuelve a anular', () => {
    const v = evaluarAnulabilidad({ ...libre, anulado_at: '2026-08-18T10:00:00Z' }, sinCC)
    expect(v.anulable).toBe(false)
    if (!v.anulable) expect(v.motivo).toBe('ya_anulado')
  })

  it('la pasarela gana sobre la cuenta de cobro: se reporta el bloqueo mas duro primero', () => {
    const v = evaluarAnulabilidad(
      { tipo_cobro: 'anticipo', fuente: 'epayco' },
      { enCuentaCobroEmitida: true },
    )
    expect(v.anulable).toBe(false)
    if (!v.anulable) expect(v.motivo).toBe('pasarela')
  })
})
