import { describe, it, expect } from 'vitest'
import {
  lineaDeclaraCierre,
  permiteCompletar,
  permiteCierreNoFacturable,
  accionDeCierre,
  type EtapaCierre,
} from './etapa-cierre'

/** Las etapas reales de SOENA que motivaron el cambio (medidas 2026-08-18). */
const ENTREGA: EtapaCierre = { stage: 'venta', esCierre: false }
const SEGUIMIENTO: EtapaCierre = { stage: 'venta', esCierre: false }
const FACTURACION: EtapaCierre = { stage: 'cobro', esCierre: true }
const PAGO_UPME: EtapaCierre = { stage: 'cobro', esCierre: false }
const CERTIFICACION: EtapaCierre = { stage: 'ejecucion', esCierre: false }

describe('lineaDeclaraCierre', () => {
  it('basta una etapa declarada', () => {
    expect(lineaDeclaraCierre([ENTREGA, FACTURACION])).toBe(true)
  })

  it('sin ninguna declarada, la linea sigue en el criterio viejo', () => {
    expect(lineaDeclaraCierre([ENTREGA, PAGO_UPME, CERTIFICACION])).toBe(false)
  })

  it('una lista vacia no declara nada', () => {
    expect(lineaDeclaraCierre([])).toBe(false)
  })
})

describe('permiteCompletar — con la linea declarando cierre', () => {
  it('la etapa declarada cierra, aunque su stage sea cobro', () => {
    expect(permiteCompletar(FACTURACION, true)).toBe(true)
  })

  it('⚠️ una etapa de stage cobro que NO es la de cierre deja de completar', () => {
    // Pago UPME es 'cobro' porque ahi paga la financiera, no porque el proceso termine.
    expect(permiteCompletar(PAGO_UPME, true)).toBe(false)
  })

  it('una etapa de venta declarada como cierre SI completa', () => {
    // Es el caso que habilita mover el cierre a Entrega y Seguimiento por config.
    expect(permiteCompletar({ stage: 'venta', esCierre: true }, true)).toBe(true)
  })

  it('el orden no participa: terminalLegacy se ignora', () => {
    expect(permiteCompletar({ ...SEGUIMIENTO, terminalLegacy: true }, true)).toBe(false)
  })
})

describe('permiteCompletar — sin declaracion, el criterio viejo intacto', () => {
  it('stage cobro completa', () => {
    expect(permiteCompletar(PAGO_UPME, false)).toBe(true)
  })

  it('ejecucion completa solo si es terminal por orden', () => {
    expect(permiteCompletar({ ...CERTIFICACION, terminalLegacy: true }, false)).toBe(true)
    expect(permiteCompletar({ ...CERTIFICACION, terminalLegacy: false }, false)).toBe(false)
  })

  it('venta nunca completa', () => {
    expect(permiteCompletar({ ...ENTREGA, terminalLegacy: true }, false)).toBe(false)
  })

  it('terminalLegacy ausente se lee como false, no como true', () => {
    expect(permiteCompletar(CERTIFICACION, false)).toBe(false)
  })
})

describe('permiteCierreNoFacturable', () => {
  it('sigue exactamente a la etapa de cierre cuando la linea declara', () => {
    expect(permiteCierreNoFacturable(FACTURACION, true)).toBe(true)
    expect(permiteCierreNoFacturable(PAGO_UPME, true)).toBe(false)
  })

  it('aparece en una etapa de venta declarada como cierre', () => {
    // Antes era imposible: estaba amarrada a stage === 'cobro'.
    expect(permiteCierreNoFacturable({ stage: 'venta', esCierre: true }, true)).toBe(true)
  })

  it('sin declaracion conserva el amarre a cobro', () => {
    expect(permiteCierreNoFacturable(PAGO_UPME, false)).toBe(true)
    expect(permiteCierreNoFacturable(ENTREGA, false)).toBe(false)
    expect(permiteCierreNoFacturable({ ...CERTIFICACION, terminalLegacy: true }, false)).toBe(false)
  })
})

describe('accionDeCierre — el defecto visible que origino el cambio', () => {
  it('Entrega y Seguimiento declaradas dicen Cerrar, no Perder', () => {
    expect(accionDeCierre({ ...ENTREGA, esCierre: true }, true)).toBe('cerrar')
    expect(accionDeCierre({ ...SEGUIMIENTO, esCierre: true }, true)).toBe('cerrar')
  })

  it('hoy, sin declararlas, siguen diciendo Perder', () => {
    expect(accionDeCierre(ENTREGA, true)).toBe('perder')
    expect(accionDeCierre(SEGUIMIENTO, true)).toBe('perder')
  })

  it('una etapa de ejecucion que no cierra se cancela, no se pierde', () => {
    expect(accionDeCierre(CERTIFICACION, true)).toBe('cancelar')
  })

  it('Facturacion dice Cerrar', () => {
    expect(accionDeCierre(FACTURACION, true)).toBe('cerrar')
  })

  it('sin declaracion, una etapa de cobro dice Cerrar como siempre', () => {
    expect(accionDeCierre(PAGO_UPME, false)).toBe('cerrar')
  })
})
