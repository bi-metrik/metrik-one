import { describe, it, expect } from 'vitest'
import {
  PLANTILLA_POR_DEFECTO,
  plantillaCotizacionPropia,
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

  it('el registro declara exactamente los slugs que se sabe que existen', () => {
    // Si mañana se agrega otro, esta prueba obliga a decirlo aquí — y a revisar que
    // el slug nuevo no esté ya en uso por el servicio externo.
    expect(slugsConPlantillaPropia()).toEqual(['termotech'])
  })
})
