import { describe, expect, it } from 'vitest'
import {
  diaCierrePorInactividad,
  diaEscalarSupervisor,
  nivelesInactividadVenta,
} from './escalamiento-inactividad'

describe('nivelesInactividadVenta', () => {
  it('con el umbral de siempre reproduce la escalera 3/5/7/15', () => {
    expect(nivelesInactividadVenta(3).map(n => n.dias)).toEqual([15, 7, 5, 3])
    expect(nivelesInactividadVenta(3).map(n => n.nivel)).toEqual(['15d', '7d', '5d', '3d'])
  })

  it('conserva las distancias cuando el SLA alarga el umbral', () => {
    // Seguimiento y Notificación en SOENA: SLA 240 h = 10 días hábiles.
    expect(nivelesInactividadVenta(10).map(n => n.dias)).toEqual([22, 14, 12, 10])
  })

  it('va de mayor a menor: el cron toma el primero que se alcanza', () => {
    const dias = nivelesInactividadVenta(5).map(n => n.dias)
    expect([...dias].sort((a, b) => b - a)).toEqual(dias)
  })

  it('el primer nivel es el umbral exacto, no un día después', () => {
    // Si el nivel más bajo empezara por encima del umbral, habría negocios que
    // ameritan aviso y no encuentran nivel: el cron los saltaría en silencio.
    expect(nivelesInactividadVenta(7).at(-1)?.dias).toBe(7)
  })
})

describe('diaCierrePorInactividad', () => {
  it('mantiene los 15 días de hoy cuando el umbral es 3', () => {
    expect(diaCierrePorInactividad(3)).toBe(15)
  })

  it('se corre con el umbral: preguntar si se cierra un caso que la etapa todavía espera sería falso', () => {
    expect(diaCierrePorInactividad(10)).toBe(22)
  })
})

describe('diaEscalarSupervisor', () => {
  it('respeta la config del workspace mientras el umbral no la alcance', () => {
    expect(diaEscalarSupervisor(3, 7)).toBe(7)
    expect(diaEscalarSupervisor(2, 7)).toBe(7)
  })

  it('nunca deja al supervisor enterándose antes que el responsable', () => {
    // Umbral 10 (SLA 240 h) con la config de SOENA en 7: sin el max, el supervisor
    // recibiría el aviso el día 7, cuando el aviso todavía no existe.
    expect(diaEscalarSupervisor(10, 7)).toBe(10)
  })

  it('una config agresiva sigue valiendo: escalar desde el primer aviso', () => {
    expect(diaEscalarSupervisor(3, 1)).toBe(3)
  })
})
