import { describe, it, expect } from 'vitest'
import {
  evaluarReferencia,
  totalDeclaradoDeReferencia,
} from './sobreasignacion'

describe('evaluarReferencia', () => {
  it('una referencia sin nada registrado esta libre', () => {
    const v = evaluarReferencia({ total: 1_020_000, registrado: 0 })
    expect(v.estado).toBe('libre')
    expect(v.sin_asignar).toBe(1_020_000)
  })

  it('el caso real: registrar el total completo por segunda vez SE ALERTA', () => {
    // Ref 378962162: pago real de $1.020.000, ya consumido por V0256.
    const v = evaluarReferencia({
      total: 1_020_000,
      registrado: 1_020_000,
      nuevo: 1_020_000,
    })
    expect(v.estado).toBe('sobreasignada')
    expect(v.excedente).toBe(1_020_000)
  })

  it('el reparto legitimo entre dos negocios NO se alerta', () => {
    // 50/50 tipo V0277 / V0287 sobre un pago de $701.812.
    const primera = evaluarReferencia({ total: 701_812, registrado: 0, nuevo: 350_906 })
    expect(primera.estado).toBe('incompleta')
    expect(primera.sin_asignar).toBe(350_906)

    const segunda = evaluarReferencia({ total: 701_812, registrado: 350_906, nuevo: 350_906 })
    expect(segunda.estado).toBe('cuadra')
    expect(segunda.excedente).toBe(0)
  })

  it('un reparto a medias queda visible como incompleto', () => {
    const v = evaluarReferencia({ total: 1_000_000, registrado: 400_000 })
    expect(v.estado).toBe('incompleta')
    expect(v.sin_asignar).toBe(600_000)
  })

  it('un residuo de redondeo no es un duplicado (tolerancia de materialidad)', () => {
    expect(evaluarReferencia({ total: 1_000_000, registrado: 1_000_500 }).estado).toBe('cuadra')
    expect(evaluarReferencia({ total: 1_000_000, registrado: 999_500 }).estado).toBe('cuadra')
    // Un peso mas que la tolerancia si alerta.
    expect(evaluarReferencia({ total: 1_000_000, registrado: 1_001_001 }).estado).toBe('sobreasignada')
  })

  it('sin total declarado, lo registrado se toma como el pago (no se inventa una vara)', () => {
    const v = evaluarReferencia({ total: 0, registrado: 500_000 })
    expect(v.estado).toBe('cuadra')
    expect(v.excedente).toBe(0)
    expect(v.sin_asignar).toBe(0)
  })

  it('valores no numericos no producen NaN', () => {
    const v = evaluarReferencia({
      total: Number('x'),
      registrado: Number(undefined),
      nuevo: 100,
    })
    expect(Number.isFinite(v.asignado)).toBe(true)
    expect(v.asignado).toBe(100)
  })
})

describe('totalDeclaradoDeReferencia', () => {
  it('usa el mayor split_total declarado', () => {
    const total = totalDeclaradoDeReferencia([
      { monto: 350_906, split_json: { split_total: 701_812 } },
      { monto: 350_906, split_json: { split_total: 701_812 } },
    ])
    expect(total).toBe(701_812)
  })

  it('sin declaracion, un pago a un solo negocio se declara a si mismo', () => {
    expect(totalDeclaradoDeReferencia([{ monto: 500_000, split_json: null }])).toBe(500_000)
  })

  it('sin declaracion pero con varias filas, suma lo registrado', () => {
    // Es el estado en el que quedan los pagos cargados antes de este control: la
    // referencia se declara a si misma con lo que ya tiene, y a partir de ahi
    // cualquier registro nuevo la sobre-asigna. Es el comportamiento deseado.
    expect(
      totalDeclaradoDeReferencia([{ monto: 600_000 }, { monto: 400_000 }]),
    ).toBe(1_000_000)
  })

  it('una lista vacia da cero', () => {
    expect(totalDeclaradoDeReferencia([])).toBe(0)
  })
})
