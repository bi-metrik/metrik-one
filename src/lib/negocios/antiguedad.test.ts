import { describe, it, expect } from 'vitest'
import { diasDesde, etiquetaAntiguedad, compararPorAntiguedad } from './antiguedad'

// Reloj fijo: estas pruebas no pueden depender de cuándo se corran.
const AHORA = new Date('2026-08-06T17:00:00.000Z').getTime()

describe('diasDesde', () => {
  it('cuenta días CUMPLIDOS, no cambios de fecha en el calendario', () => {
    // Ayer a las 23:00 UTC: cambió el día, pero no han pasado 24 horas.
    expect(diasDesde('2026-08-05T23:00:00.000Z', AHORA)).toBe(0)
    // 24 horas exactas.
    expect(diasDesde('2026-08-05T17:00:00.000Z', AHORA)).toBe(1)
    expect(diasDesde('2026-08-05T16:59:59.000Z', AHORA)).toBe(1)
  })

  // Casos reales de SOENA medidos el 2026-08-06: los tres faltantes de la pestaña.
  it('reproduce la antigüedad de los faltantes vivos', () => {
    expect(diasDesde('2026-07-15T00:00:00.000Z', AHORA)).toBe(22) // V0072
    expect(diasDesde('2026-07-27T00:00:00.000Z', AHORA)).toBe(10) // V0124
    expect(diasDesde('2026-08-06T15:33:00.000Z', AHORA)).toBe(0)  // V0292, creado hoy
  })

  // Un dato ausente se muestra ausente. Un 0 diría "recién creado", que es una
  // afirmación falsa sobre algo que no sabemos.
  it('sin fecha devuelve null, nunca cero', () => {
    expect(diasDesde(null, AHORA)).toBeNull()
    expect(diasDesde(undefined, AHORA)).toBeNull()
    expect(diasDesde('', AHORA)).toBeNull()
    expect(diasDesde('no es una fecha', AHORA)).toBeNull()
  })

  it('una fecha futura da 0, no un negativo', () => {
    // Pasa por desfase de reloj entre servidor y base. "-1 días" no significa nada
    // en una pantalla de cartera.
    expect(diasDesde('2026-08-07T00:00:00.000Z', AHORA)).toBe(0)
  })

  it('un reloj inválido no inventa un número', () => {
    expect(diasDesde('2026-07-15T00:00:00.000Z', Number.NaN)).toBeNull()
  })
})

describe('etiquetaAntiguedad', () => {
  it('singular, plural y el día de hoy', () => {
    expect(etiquetaAntiguedad(0)).toBe('hoy')
    expect(etiquetaAntiguedad(1)).toBe('1 día')
    expect(etiquetaAntiguedad(22)).toBe('22 días')
  })

  it('sin dato no escribe nada', () => {
    expect(etiquetaAntiguedad(null)).toBe('')
    expect(etiquetaAntiguedad(undefined)).toBe('')
  })
})

describe('compararPorAntiguedad', () => {
  const fila = (dias: number | null, saldo: number) => ({ dias_desde_creacion: dias, saldo })

  it('primero lo mas viejo, sin importar el monto', () => {
    const lista = [fila(12, 850_000), fila(174, 637_500), fila(3, 900_000)]
    expect(lista.sort(compararPorAntiguedad).map((f) => f.dias_desde_creacion)).toEqual([174, 12, 3])
  })

  it('el caso real de SOENA: 70 faltantes con el MISMO monto se ordenan por dias', () => {
    // 70 negocios abiertos deben exactamente $637.500. Con el orden por monto quedaban
    // al azar; con este, el que lleva mas esperando sale de primero.
    const lista = Array.from({ length: 70 }, (_, i) => fila(i + 3, 637_500))
    const ordenada = lista.sort(compararPorAntiguedad)
    expect(ordenada[0].dias_desde_creacion).toBe(72)
    expect(ordenada[69].dias_desde_creacion).toBe(3)
  })

  it('a igual antiguedad desempata el monto mas grande', () => {
    const lista = [fila(50, 100_000), fila(50, 800_000), fila(50, 300_000)]
    expect(lista.sort(compararPorAntiguedad).map((f) => f.saldo)).toEqual([800_000, 300_000, 100_000])
  })

  it('los SOBRANTES quedan del mas grande al mas chico (el orden viejo los invertia)', () => {
    // Caso real: V0310 sobra $122.031 y V0256 sobra $510.000, ambos con saldo negativo.
    // `b.saldo - a.saldo` ponia primero al mas chico. El desempate va en valor absoluto.
    const lista = [fila(7, -122_031), fila(7, -510_000)]
    expect(lista.sort(compararPorAntiguedad).map((f) => f.saldo)).toEqual([-510_000, -122_031])
  })

  it('sin fecha de creacion se va al final, no al principio', () => {
    const lista = [fila(null, 999_999), fila(1, 1_000)]
    expect(lista.sort(compararPorAntiguedad).map((f) => f.dias_desde_creacion)).toEqual([1, null])
  })
})
