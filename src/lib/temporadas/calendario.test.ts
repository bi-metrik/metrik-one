import { describe, expect, it } from 'vitest'

import { copiarAnio, diasSinTemporada, domingoDePascua, revisarRango, semanaSanta, solapes, temporadaDeFecha, type RangoTemporada } from './calendario'

const r = (temporada: RangoTemporada['temporada'], desde: string, hasta: string, nombre: string | null = null): RangoTemporada => ({ anio: Number(desde.slice(0, 4)), temporada, desde, hasta, nombre })

describe('calendario de temporadas', () => {
  it('Pascua y Semana Santa de años conocidos', () => {
    expect(domingoDePascua(2025)).toBe('2025-04-20')
    expect(domingoDePascua(2026)).toBe('2026-04-05')
    expect(domingoDePascua(2027)).toBe('2027-03-28')
    expect(semanaSanta(2026)).toEqual({ desde: '2026-03-29', hasta: '2026-04-05' })
  })

  it('una fecha cubierta por dos rangos toma la temporada más alta (Semana Santa dentro de una media)', () => {
    const cal = [r('media', '2026-03-15', '2026-04-30'), r('alta', '2026-03-29', '2026-04-05', 'Semana Santa'), r('baja', '2026-05-01', '2026-06-14')]
    expect(temporadaDeFecha(cal, '2026-04-02')?.temporada).toBe('alta')
    expect(temporadaDeFecha(cal, '2026-04-20')?.temporada).toBe('media')
    expect(temporadaDeFecha(cal, '2026-05-10')?.temporada).toBe('baja')
    expect(temporadaDeFecha(cal, '2026-07-01')).toBeNull()
    expect(temporadaDeFecha(cal, '2026-02-30')).toBeNull()
  })

  it('un rango que cruza el año sirve en enero del siguiente', () => {
    const cal = [r('alta', '2026-12-15', '2027-01-15', 'Fin de año')]
    expect(temporadaDeFecha(cal, '2027-01-10')?.rango.nombre).toBe('Fin de año')
  })

  it('copiar el año: corre día y mes, recalcula Semana Santa y el 29 de febrero', () => {
    const cal = [r('alta', '2028-02-25', '2028-02-29'), r('alta', '2028-04-09', '2028-04-16', 'Semana Santa'), r('baja', '2028-05-01', '2028-06-15'), r('media', '2027-07-01', '2027-07-31')]
    const copia = copiarAnio(cal, 2028, 2029)
    expect(copia).toEqual([
      { anio: 2029, temporada: 'alta', desde: '2029-02-25', hasta: '2029-02-28', nombre: null, recalculado: false },
      { anio: 2029, temporada: 'alta', desde: '2029-03-25', hasta: '2029-04-01', nombre: 'Semana Santa', recalculado: true },
      { anio: 2029, temporada: 'baja', desde: '2029-05-01', hasta: '2029-06-15', nombre: null, recalculado: false },
    ])
  })

  it('revisa el rango del formulario', () => {
    expect(revisarRango({ temporada: 'alta', desde: '2026-12-15', hasta: '2027-01-15', nombre: '  Fin  de año ' })).toEqual({
      ok: true,
      rango: { anio: 2026, temporada: 'alta', desde: '2026-12-15', hasta: '2027-01-15', nombre: 'Fin de año' },
    })
    expect(revisarRango({ temporada: 'altísima', desde: '2026-01-01', hasta: '2026-01-02' })).toMatchObject({ ok: false })
    expect(revisarRango({ temporada: 'baja', desde: '2026-02-01', hasta: '2026-01-01' })).toMatchObject({ ok: false, error: expect.stringMatching(/antes/) })
    expect(revisarRango({ temporada: 'baja', desde: '2026-01-01', hasta: '2027-06-01' })).toMatchObject({ ok: false, error: expect.stringMatching(/año/) })
    expect(revisarRango({ temporada: 'baja', desde: '2026-02-30', hasta: '2026-03-01' })).toMatchObject({ ok: false })
  })

  it('avisa solapes entre temporadas distintas y días sin temporada', () => {
    const cal = [r('media', '2026-01-01', '2026-06-30'), r('alta', '2026-03-29', '2026-04-05'), r('baja', '2026-07-01', '2026-12-30')]
    expect(solapes(cal)).toHaveLength(1)
    expect(diasSinTemporada(cal, 2026)).toBe(1)
  })
})
