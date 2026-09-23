import { describe, expect, it } from 'vitest'

import {
  avisoDeBorrador,
  lineaDeMotivos,
  motivosDeBorrador,
  textoDeMarca,
  type CondicionesDeBorrador,
} from './motivos-borrador'

/** Las 16 combinaciones de las cuatro condiciones. */
function todas(): CondicionesDeBorrador[] {
  const out: CondicionesDeBorrador[] = []
  for (let i = 0; i < 16; i++) {
    out.push({
      pantallazos: (i & 1) !== 0,
      margen: (i & 2) !== 0,
      ivaSinCalcular: (i & 4) !== 0,
      ivaIncluidoSinPlantilla: (i & 8) !== 0,
    })
  }
  return out
}

describe('motivos de borrador: CUÁNDO no cambia, solo el texto', () => {
  it('es borrador exactamente cuando antes: el OR de las cuatro condiciones, en las 16 combinaciones', () => {
    for (const c of todas()) {
      const antes = c.pantallazos || c.margen || c.ivaSinCalcular || c.ivaIncluidoSinPlantilla
      expect(motivosDeBorrador(c).length > 0).toBe(antes)
    }
  })

  it('cada condición aporta su motivo, y en un orden fijo: pantallazos, margen, IVA', () => {
    expect(motivosDeBorrador({ pantallazos: true, margen: true, ivaSinCalcular: true, ivaIncluidoSinPlantilla: true }))
      .toEqual(['pantallazos', 'margen', 'iva_sin_calcular', 'iva_incluido_sin_plantilla'])
    expect(motivosDeBorrador({ pantallazos: false, margen: false, ivaSinCalcular: true, ivaIncluidoSinPlantilla: false }))
      .toEqual(['iva_sin_calcular'])
  })
})

describe('el texto de la marca', () => {
  it('un motivo: su nombre llano', () => {
    expect(textoDeMarca(['margen'])).toBe('BORRADOR · margen bajo el mínimo · no enviar')
    expect(textoDeMarca(['pantallazos'])).toBe('BORRADOR · pantallazos por actualizar · no enviar')
    expect(textoDeMarca(['iva_sin_calcular'])).toBe('BORRADOR · IVA sin calcular · no enviar')
    expect(textoDeMarca(['iva_incluido_sin_plantilla'])).toBe('BORRADOR · IVA incluido sin plantilla · no enviar')
  })

  it('dos motivos: se leen los dos', () => {
    expect(lineaDeMotivos(['margen', 'iva_sin_calcular'])).toBe('margen bajo el mínimo · IVA sin calcular · no enviar')
  })

  it('tres o más: el principal y «y N más» (el aviso de pantalla los dice todos)', () => {
    expect(lineaDeMotivos(['pantallazos', 'margen', 'iva_sin_calcular']))
      .toBe('pantallazos por actualizar y 2 más · no enviar')
    expect(lineaDeMotivos(['pantallazos', 'margen', 'iva_sin_calcular', 'iva_incluido_sin_plantilla']))
      .toBe('pantallazos por actualizar y 3 más · no enviar')
  })

  it('sin motivos no hay marca', () => {
    expect(() => lineaDeMotivos([])).toThrow('al menos un motivo')
  })
})

describe('el aviso de pantalla sale de la misma lista', () => {
  it('empieza con la marca del documento y sigue con el detalle de cada motivo, en el mismo orden', () => {
    const aviso = avisoDeBorrador(['margen', 'iva_sin_calcular'], {
      margen: 'Margen de 3 % bajo el mínimo de 5 %.',
      iva_sin_calcular: 'La línea «TOUR» tiene precio y no tiene costo.',
    })
    expect(aviso).toBe(
      'PDF de borrador, con la marca «BORRADOR · margen bajo el mínimo · IVA sin calcular · no enviar»: '
      + 'no se puede enviar. Margen de 3 % bajo el mínimo de 5 %. La línea «TOUR» tiene precio y no tiene costo.',
    )
  })

  it('un detalle de un motivo que no aplica no se cuela', () => {
    const aviso = avisoDeBorrador(['iva_sin_calcular'], {
      margen: 'NO DEBE SALIR',
      iva_sin_calcular: 'Falta el costo.',
    })
    expect(aviso).not.toContain('NO DEBE SALIR')
    expect(aviso).toContain('«BORRADOR · IVA sin calcular · no enviar»')
  })
})
