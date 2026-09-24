import { describe, expect, it } from 'vitest'
import {
  costoEnFecha,
  costoVigente,
  gananciaPorVenta,
  precioPiso,
  precioRegla,
  semaforoPendiente,
  validarPiso,
} from './reglas'

describe('ganancia por venta', () => {
  it('aplica la fórmula del piloto: precio x 0,777933 - costo x 0,840336', () => {
    // 100.000 x 0,777933 - 60.000 x 0,840336 = 77.793,3 - 50.420,16 = 27.373,14
    expect(gananciaPorVenta(100_000, 60_000)).toBe(27_373)
  })

  it('el piso es el precio donde la ganancia deja de ser negativa', () => {
    const costo = 60_000
    const piso = precioPiso(costo)
    expect(gananciaPorVenta(piso, costo)).toBeGreaterThanOrEqual(0)
    expect(gananciaPorVenta(piso - 5, costo)).toBeLessThan(0)
  })

  it('la regla del piloto es 1,25 x costo F', () => {
    expect(precioRegla(80_000)).toBe(100_000)
  })
})

describe('validarPiso', () => {
  const costo = 80_000 // piso ≈ 86.418, regla = 100.000

  it('sin costo vigente rechaza: no hay cómo medir el piso', () => {
    const r = validarPiso(120_000, null)
    expect(r).toMatchObject({ ok: false, codigo: 'sin_costo' })
  })

  it('ganancia negativa se rechaza aunque traiga motivo', () => {
    const r = validarPiso(70_000, costo, 'liquidación')
    expect(r).toMatchObject({ ok: false, codigo: 'ganancia_negativa' })
  })

  it('bajo 1,25 x costo sin motivo se rechaza pidiendo el motivo', () => {
    const r = validarPiso(95_000, costo)
    expect(r).toMatchObject({ ok: false, codigo: 'falta_motivo' })
  })

  it('bajo 1,25 x costo con motivo pasa y avisa que está bajo la regla', () => {
    const r = validarPiso(95_000, costo, 'igualar a Homecenter')
    expect(r).toMatchObject({ ok: true, bajoRegla: true })
  })

  it('un motivo en blanco no cuenta como motivo', () => {
    expect(validarPiso(95_000, costo, '   ')).toMatchObject({ ok: false, codigo: 'falta_motivo' })
  })

  it('sobre la regla pasa sin motivo', () => {
    expect(validarPiso(100_000, costo)).toMatchObject({ ok: true, bajoRegla: false })
  })

  it('precio no positivo se rechaza', () => {
    expect(validarPiso(0, costo)).toMatchObject({ ok: false, codigo: 'precio_invalido' })
  })
})

describe('costo vigente', () => {
  const costos = [
    { fecha_lista: '2026-09-02', costo_f: 50_000, costo_d: 60_000 },
    { fecha_lista: '2026-09-23', costo_f: 55_000, costo_d: 60_000 },
    { fecha_lista: '2026-09-22', costo_f: 52_000, costo_d: 60_000 },
  ]

  it('es el de la lista más reciente, sin importar el orden', () => {
    expect(costoVigente(costos)?.costo_f).toBe(55_000)
  })

  it('en una fecha es la última lista publicada ese día o antes', () => {
    expect(costoEnFecha(costos, '2026-09-22')?.costo_f).toBe(52_000)
    expect(costoEnFecha(costos, '2026-09-01')).toBeNull()
  })
})

describe('semáforo de pendientes', () => {
  const ahora = new Date('2026-10-05T12:00:00Z')

  it('sin pendiente no hay semáforo', () => {
    expect(semaforoPendiente({ pendiente_en_canal: false, pendiente_desde: null, intentos_fallidos: 0 }, ahora)).toBeNull()
  })

  it('pendiente reciente es ámbar', () => {
    expect(
      semaforoPendiente({ pendiente_en_canal: true, pendiente_desde: '2026-10-05T08:00:00Z', intentos_fallidos: 1 }, ahora),
    ).toBe('ambar')
  })

  it('dos corridas con error es rojo', () => {
    expect(
      semaforoPendiente({ pendiente_en_canal: true, pendiente_desde: '2026-10-05T08:00:00Z', intentos_fallidos: 2 }, ahora),
    ).toBe('rojo')
  })

  it('más de 48 horas sin confirmar es rojo aunque no haya errores', () => {
    expect(
      semaforoPendiente({ pendiente_en_canal: true, pendiente_desde: '2026-10-03T08:00:00Z', intentos_fallidos: 0 }, ahora),
    ).toBe('rojo')
  })
})
