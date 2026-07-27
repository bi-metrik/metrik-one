import { describe, it, expect } from 'vitest'
import { horasHabilesEntre, slaHorasDeEtapa } from './horas-habiles'

const FESTIVOS_2026 = new Set([
  '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03',
  '2026-05-01', '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29',
  '2026-07-20', '2026-08-07', '2026-08-17', '2026-10-12', '2026-11-02',
  '2026-11-16', '2026-12-08', '2026-12-25',
])

describe('horasHabilesEntre', () => {
  it('cuenta horas calendario cuando el rango cae dentro de un dia habil', () => {
    // Lunes 2026-07-27, 3 horas.
    const h = horasHabilesEntre(
      '2026-07-27T10:00:00Z',
      new Date('2026-07-27T13:00:00Z').getTime(),
      FESTIVOS_2026,
    )
    expect(h).toBe(3)
  })

  it('descuenta 24h por cada sabado y domingo', () => {
    // Viernes 24 jul 12:00 → lunes 27 jul 12:00 = 72h calendario, menos sab+dom.
    const h = horasHabilesEntre(
      '2026-07-24T12:00:00Z',
      new Date('2026-07-27T12:00:00Z').getTime(),
      FESTIVOS_2026,
    )
    expect(h).toBe(24)
  })

  it('descuenta 24h por festivo colombiano (20 de julio)', () => {
    // Viernes 17 jul 12:00 → martes 21 jul 12:00 = 96h, menos sab, dom y el 20 (festivo).
    const h = horasHabilesEntre(
      '2026-07-17T12:00:00Z',
      new Date('2026-07-21T12:00:00Z').getTime(),
      FESTIVOS_2026,
    )
    expect(h).toBe(24)
  })

  it('nunca devuelve negativo ni cuenta rangos invertidos', () => {
    const fin = new Date('2026-07-27T12:00:00Z').getTime()
    expect(horasHabilesEntre('2026-07-28T12:00:00Z', fin, FESTIVOS_2026)).toBe(0)
    expect(horasHabilesEntre('2026-07-27T12:00:00Z', fin, FESTIVOS_2026)).toBe(0)
    expect(horasHabilesEntre('no-es-fecha', fin, FESTIVOS_2026)).toBe(0)
  })

  it('replica exactamente la funcion SQL horas_habiles_entre', () => {
    // Paridad verificada contra `select horas_habiles_entre(etapa_cambiada_at, now())`
    // en negocios reales del workspace SOENA con ahora = 2026-07-27T21:12:06.961623Z.
    // Si esta prueba falla, el badge de atraso del listado dejo de coincidir con
    // /flujo y /equipo.
    const ahora = new Date('2026-07-27T21:12:06.961623Z').getTime()
    const casos: Array<[string, number]> = [
      ['2026-07-09T20:40:06.212974Z', 264.533541],
      ['2026-07-10T21:45:29.10207Z', 239.443850],
      ['2026-07-15T00:20:50.026496Z', 188.854704],
      ['2026-07-16T22:21:08.781742Z', 142.849494],
      ['2026-07-17T17:39:30.291525Z', 123.543519],
      ['2026-07-17T22:57:45.444047Z', 118.239310],
      ['2026-07-21T07:10:53.339186Z', 110.020451],
    ]
    for (const [inicio, esperadoSql] of casos) {
      expect(horasHabilesEntre(inicio, ahora, FESTIVOS_2026)).toBeCloseTo(esperadoSql, 5)
    }
  })
})

describe('slaHorasDeEtapa', () => {
  it('lee sla_horas numerico', () => {
    expect(slaHorasDeEtapa({ sla_horas: 6 })).toBe(6)
  })

  it('acepta el valor como string (json sin tipar)', () => {
    expect(slaHorasDeEtapa({ sla_horas: '24' })).toBe(24)
  })

  it('devuelve null cuando la etapa no tiene SLA', () => {
    expect(slaHorasDeEtapa(null)).toBeNull()
    expect(slaHorasDeEtapa({})).toBeNull()
    expect(slaHorasDeEtapa({ sla_horas: null })).toBeNull()
    expect(slaHorasDeEtapa({ sla_horas: '' })).toBeNull()
  })

  it('descarta valores no positivos o no numericos', () => {
    expect(slaHorasDeEtapa({ sla_horas: 0 })).toBeNull()
    expect(slaHorasDeEtapa({ sla_horas: -3 })).toBeNull()
    expect(slaHorasDeEtapa({ sla_horas: 'pronto' })).toBeNull()
  })
})
