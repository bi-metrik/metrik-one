import { describe, it, expect } from 'vitest'
import {
  horasHabilesEntre,
  horasHabilesEnJornada,
  slaHorasDeEtapa,
  JORNADA_DIA_COMPLETO,
} from './horas-habiles'

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

const ms = (iso: string) => new Date(iso).getTime()

describe('horasHabilesEnJornada', () => {
  it('con jornada de dia completo cuenta las horas corridas dentro de un dia habil', () => {
    // Lunes 27-jul, 10:00 a 13:00 en Bogota.
    expect(
      horasHabilesEnJornada(ms('2026-07-27T15:00:00Z'), ms('2026-07-27T18:00:00Z'), FESTIVOS_2026),
    ).toBe(3)
  })

  it('no cuenta el fin de semana', () => {
    // Viernes 24-jul 12:00 Bogota -> lunes 27-jul 12:00 Bogota = 72 h corridas.
    expect(
      horasHabilesEnJornada(ms('2026-07-24T17:00:00Z'), ms('2026-07-27T17:00:00Z'), FESTIVOS_2026),
    ).toBe(24)
  })

  it('descuenta tambien el ULTIMO dia si cae en fin de semana', () => {
    // Es la diferencia con `horasHabilesEntre`, que solo mira [dia(inicio), dia(fin)).
    const desde = ms('2026-07-24T17:00:00Z') // viernes 12:00 Bogota
    const hasta = ms('2026-07-25T17:00:00Z') // sabado 12:00 Bogota
    expect(horasHabilesEnJornada(desde, hasta, FESTIVOS_2026)).toBe(12)
    expect(horasHabilesEntre('2026-07-24T17:00:00Z', hasta, FESTIVOS_2026)).toBe(24)
  })

  it('descuenta los festivos colombianos', () => {
    // Viernes 17-jul 12:00 -> martes 21-jul 12:00 Bogota: sab, dom y el 20 (festivo).
    expect(
      horasHabilesEnJornada(ms('2026-07-17T17:00:00Z'), ms('2026-07-21T17:00:00Z'), FESTIVOS_2026),
    ).toBe(24)
  })

  it('corta los dias en hora de BOGOTA, no en UTC', () => {
    // Viernes 24-jul 20:00 Bogota = sabado 01:00 UTC. Con corte UTC ese tramo caeria
    // en sabado y no contaria; en Bogota sigue siendo viernes y son 4 h habiles.
    expect(
      horasHabilesEnJornada(ms('2026-07-25T01:00:00Z'), ms('2026-07-25T04:59:59Z'), FESTIVOS_2026),
    ).toBeCloseTo(4, 3)
  })

  it('el sabado cuenta solo si la jornada lo declara habil', () => {
    const desde = ms('2026-07-25T15:00:00Z') // sabado 10:00 Bogota
    const hasta = ms('2026-07-25T18:00:00Z') // sabado 13:00 Bogota
    expect(horasHabilesEnJornada(desde, hasta, FESTIVOS_2026)).toBe(0)
    expect(
      horasHabilesEnJornada(desde, hasta, FESTIVOS_2026, {
        ...JORNADA_DIA_COMPLETO,
        sabadoHabil: true,
      }),
    ).toBe(3)
  })

  it('con jornada acotada solo suma lo que cae dentro de la ventana', () => {
    // Lunes 27-jul de 06:00 a 20:00 Bogota, jornada 8-18 => 10 h, no 14.
    expect(
      horasHabilesEnJornada(
        ms('2026-07-27T11:00:00Z'),
        ms('2026-07-28T01:00:00Z'),
        FESTIVOS_2026,
        { inicioHora: 8, finHora: 18, sabadoHabil: false },
      ),
    ).toBe(10)
  })

  it('nunca devuelve negativo ni cuenta rangos invertidos', () => {
    const a = ms('2026-07-27T15:00:00Z')
    const b = ms('2026-07-27T18:00:00Z')
    expect(horasHabilesEnJornada(b, a, FESTIVOS_2026)).toBe(0)
    expect(horasHabilesEnJornada(a, a, FESTIVOS_2026)).toBe(0)
    expect(horasHabilesEnJornada(NaN, b, FESTIVOS_2026)).toBe(0)
  })

  it('una jornada vacia o invertida no acredita horas', () => {
    const desde = ms('2026-07-27T11:00:00Z')
    const hasta = ms('2026-07-28T01:00:00Z')
    expect(
      horasHabilesEnJornada(desde, hasta, FESTIVOS_2026, { inicioHora: 18, finHora: 8, sabadoHabil: false }),
    ).toBe(0)
  })

  it('un anio sin festivos sembrados los cuenta como habiles', () => {
    // Sin el 20 de julio en la tabla, ese dia suma. Es el limite declarado del
    // criterio: la cobertura de `festivos_colombia` es parte de la regla.
    const desde = ms('2026-07-17T17:00:00Z')
    const hasta = ms('2026-07-21T17:00:00Z')
    expect(horasHabilesEnJornada(desde, hasta, FESTIVOS_2026)).toBe(24)
    expect(horasHabilesEnJornada(desde, hasta, new Set<string>())).toBe(48)
  })

  it('reproduce los 4 casos reales de SOENA que cambian de veredicto a 72 h', () => {
    // Medidos contra produccion el 2026-08-22. Con horas corridas los cuatro
    // incumplen; con horas habiles los cuatro cumplen, y el fin de semana o el
    // festivo es toda la diferencia.
    const casos: Array<[string, string, number, number]> = [
      ['2026-07-10T18:09:00Z', '2026-07-14T23:25:00Z', 101.3, 53.3],
      ['2026-07-30T13:20:00Z', '2026-08-03T14:45:00Z', 97.4, 49.4],
      ['2026-08-05T13:12:00Z', '2026-08-10T22:28:00Z', 129.3, 57.3],
      ['2026-08-13T21:35:00Z', '2026-08-18T17:18:00Z', 115.7, 43.7],
    ]
    for (const [desde, hasta, corridas, habiles] of casos) {
      const brutas = (ms(hasta) - ms(desde)) / 3_600_000
      expect(brutas).toBeCloseTo(corridas, 1)
      expect(horasHabilesEnJornada(ms(desde), ms(hasta), FESTIVOS_2026)).toBeCloseTo(habiles, 1)
      expect(brutas > 72).toBe(true)
      expect(horasHabilesEnJornada(ms(desde), ms(hasta), FESTIVOS_2026) <= 72).toBe(true)
    }
  })
})
