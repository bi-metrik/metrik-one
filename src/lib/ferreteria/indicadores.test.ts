import { describe, expect, it } from 'vitest'
import { calcularIndicadores, rangoDePrecio } from './indicadores'

const pubs = [
  { id: 'a', codigo: 'MP-01', precio: 120_000, linea: 'ticket_alto', estado: 'activa' },
  { id: 'b', codigo: 'MP-02', precio: 30_000, linea: 'impulso', estado: 'activa' },
  { id: 'c', codigo: 'MP-03', precio: 30_000, linea: 'impulso', estado: 'pausada' },
]

const mediciones = [
  // MP-01: línea base 40 el 24-sep, luego sube.
  { publicacion_id: 'a', fecha: '2026-09-24', clics_acumulados: 40 },
  { publicacion_id: 'a', fecha: '2026-09-30', clics_acumulados: 45 },
  { publicacion_id: 'a', fecha: '2026-10-02', clics_acumulados: 50 },
  // MP-02: no se mueve en la última semana.
  { publicacion_id: 'b', fecha: '2026-09-24', clics_acumulados: 10 },
  { publicacion_id: 'b', fecha: '2026-09-25', clics_acumulados: 12 },
  { publicacion_id: 'b', fecha: '2026-10-02', clics_acumulados: 12 },
]

describe('indicadores', () => {
  const r = calcularIndicadores(
    pubs,
    mediciones,
    [
      { publicacion_id: 'a', resultado: 'vendio' },
      { publicacion_id: 'a', resultado: 'pregunto' },
      { publicacion_id: 'b', resultado: 'pregunto' },
    ],
    [{ publicacion_id: 'a', ganancia: 25_000 }],
    '2026-10-02',
  )

  it('la primera medición es línea base: no se atribuye a su día', () => {
    expect(r.clicsPorDia.find((d) => d.fecha === '2026-09-24')).toBeUndefined()
    expect(r.clicsPorDia).toEqual([
      { fecha: '2026-09-25', clics: 2 },
      { fecha: '2026-09-30', clics: 5 },
      { fecha: '2026-10-02', clics: 5 },
    ])
  })

  it('días desde el último clic salen de la última subida del acumulado', () => {
    expect(r.porPublicacion.a).toMatchObject({ clics: 50, ultimoClic: '2026-10-02', diasDesdeUltimoClic: 0 })
    expect(r.porPublicacion.b).toMatchObject({ clics: 12, ultimoClic: '2026-09-25', diasDesdeUltimoClic: 7 })
  })

  it('una publicación sin mediciones no se inventa clics', () => {
    expect(r.porPublicacion.c).toMatchObject({ clics: null, clics7d: null, diasDesdeUltimoClic: null })
  })

  it('candidatas a repreciar: activas sin clics en los últimos 7 días (no las pausadas ni las sin medir)', () => {
    expect(r.sinClics7d).toEqual(['MP-02'])
  })

  it('tasas y ganancia realizada', () => {
    expect(r.totales).toEqual({ clics: 62, conversaciones: 3, ventas: 1, ganancia: 25_000 })
    expect(r.tasaConversacionPorClic).toBeCloseTo(3 / 62)
    expect(r.tasaVentaPorConversacion).toBeCloseTo(1 / 3)
  })

  it('agrupa por línea y por rango de precio', () => {
    expect(r.porLinea.find((g) => g.clave === 'impulso')).toMatchObject({ publicaciones: 2, clics: 12, conversaciones: 1 })
    expect(rangoDePrecio(30_000)).toBe('Menos de $50.000')
    expect(rangoDePrecio(null)).toBe('Sin precio')
    expect(r.porRangoPrecio.map((g) => g.clave)).toEqual(['Menos de $50.000', '$50.000 a $150.000'])
  })
})
