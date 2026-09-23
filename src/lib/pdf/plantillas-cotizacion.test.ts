import { describe, it, expect } from 'vitest'
import {
  PLANTILLA_POR_DEFECTO,
  plantillaCotizacionPropia,
  plantillaMuestraResumenFiscal,
  slugsConPlantillaPropia,
} from './plantillas-cotizacion'

describe('plantillaCotizacionPropia', () => {
  it('el default NO tiene plantilla propia: sigue por el camino de siempre', () => {
    expect(plantillaCotizacionPropia(PLANTILLA_POR_DEFECTO)).toBeNull()
  })

  it('un slug del servicio externo NO se secuestra', () => {
    // `wmc` vive en metrik-pdf-render. Si esta capa lo resolviera, el workspace
    // `wmc-sm` dejaría de recibir su plantilla HTML sin que nadie viera un error.
    expect(plantillaCotizacionPropia('wmc')).toBeNull()
  })

  it('sin slug no hay plantilla propia', () => {
    expect(plantillaCotizacionPropia(null)).toBeNull()
    expect(plantillaCotizacionPropia(undefined)).toBeNull()
    expect(plantillaCotizacionPropia('')).toBeNull()
  })

  it('un slug desconocido no revienta: devuelve null', () => {
    expect(plantillaCotizacionPropia('constructor')).toBeNull()
    expect(plantillaCotizacionPropia('__proto__')).toBeNull()
    expect(plantillaCotizacionPropia('toString')).toBeNull()
  })

  it('termotech sí tiene plantilla propia', () => {
    expect(plantillaCotizacionPropia('termotech')).not.toBeNull()
  })

  it('trappvel sí tiene plantilla propia', () => {
    expect(plantillaCotizacionPropia('trappvel')).not.toBeNull()
  })

  it('el registro declara exactamente los slugs que se sabe que existen', () => {
    // Si mañana se agrega otro, esta prueba obliga a decirlo aquí — y a revisar que
    // el slug nuevo no esté ya en uso por el servicio externo. `trappvel` se agregó el
    // 2026-09-21 y se comprobó contra producción que ningún workspace lo tenía puesto.
    expect(slugsConPlantillaPropia()).toEqual(['termotech', 'trappvel'])
  })
})

describe('plantillaMuestraResumenFiscal (hallazgo 33 del 2026-09-23)', () => {
  it('Trappvel no pinta el resumen fiscal del editor', () => {
    expect(plantillaMuestraResumenFiscal('trappvel')).toBe(false)
  })

  it('R6 · Termotech, WMC, la genérica y un workspace sin plantilla lo siguen viendo', () => {
    for (const slug of ['termotech', 'wmc', PLANTILLA_POR_DEFECTO, null, undefined, '', 'constructor']) {
      expect(plantillaMuestraResumenFiscal(slug)).toBe(true)
    }
  })
})
