import { describe, expect, it } from 'vitest'
import {
  REGLAS_POR_DEFECTO,
  anteriorDiaHabil,
  configDeLinea,
  fechaDeDisparo,
  sumarDiasHabiles,
  tocaHoy,
} from './reglas'

// Calendario de referencia (Colombia, 2026):
//   · vie 2026-10-09, sáb 10, dom 11, lun 12 (festivo: Día de la Raza), mar 13.
//   · vie 2026-10-16, lun 19.

describe('calendario del motor', () => {
  it('un desfase negativo que cae en día no hábil se ADELANTA: nunca se avisa tarde de un pago', () => {
    // Fecha límite mié 14 oct, −3 = dom 11 → el hábil anterior es el vie 9 (el lun 12 es festivo).
    expect(fechaDeDisparo({ offset: -3, dias: 'calendario' }, '2026-10-14')).toBe('2026-10-09')
  })

  it('cero o positivo que cae en día no hábil se CORRE al siguiente hábil', () => {
    // Límite sáb 10: el aviso del día sale el mar 13 (lun 12 festivo).
    expect(fechaDeDisparo({ offset: 0, dias: 'calendario' }, '2026-10-10')).toBe('2026-10-13')
    // Vencido +1 desde vie 9 = sáb 10 → mar 13.
    expect(fechaDeDisparo({ offset: 1, dias: 'calendario' }, '2026-10-09')).toBe('2026-10-13')
  })

  it('los toques cuentan días hábiles desde el envío (1, 3 y 7)', () => {
    // Enviada el vie 9: el 1.er hábil después es el mar 13 (sáb, dom y lun festivo no cuentan).
    expect(fechaDeDisparo({ offset: 1, dias: 'habiles' }, '2026-10-09')).toBe('2026-10-13')
    expect(fechaDeDisparo({ offset: 3, dias: 'habiles' }, '2026-10-09')).toBe('2026-10-15')
    expect(fechaDeDisparo({ offset: 7, dias: 'habiles' }, '2026-10-09')).toBe('2026-10-21')
  })

  it('sumarDiasHabiles y anteriorDiaHabil', () => {
    expect(sumarDiasHabiles('2026-10-13', -1)).toBe('2026-10-09')
    expect(sumarDiasHabiles('2026-10-11', 0)).toBe('2026-10-13')
    expect(anteriorDiaHabil('2026-10-12')).toBe('2026-10-09')
    expect(anteriorDiaHabil('2026-10-13')).toBe('2026-10-13')
    expect(anteriorDiaHabil('2026-10-13', null, false)).toBe('2026-10-09')
  })

  it('toca el día del disparo y se recupera hasta 4 días después, nunca antes ni en día no hábil', () => {
    expect(tocaHoy('2026-10-13', '2026-10-13')).toBe(true)
    expect(tocaHoy('2026-10-13', '2026-10-09')).toBe(false) // antes
    expect(tocaHoy('2026-10-13', '2026-10-16')).toBe(true) // 3 días después
    expect(tocaHoy('2026-10-13', '2026-10-17')).toBe(false) // sábado
    expect(tocaHoy('2026-10-09', '2026-10-13')).toBe(true) // 4 días: se recupera tras el puente
    expect(tocaHoy('2026-10-09', '2026-10-14')).toBe(false) // 5 días: ya no sirve
  })
})

describe('interruptor por línea', () => {
  it('ausente o distinto de true = apagado, sin reglas', () => {
    expect(configDeLinea(null)).toEqual({ activo: false, reglas: [], descartadas: 0 })
    expect(configDeLinea({})).toEqual({ activo: false, reglas: [], descartadas: 0 })
    expect(configDeLinea({ recordatorios: { activo: 'true' } }).activo).toBe(false)
    expect(configDeLinea({ recordatorios: { activo: false, reglas: REGLAS_POR_DEFECTO } }).reglas).toEqual([])
  })

  it('encendido sin reglas propias = las de por defecto (toques y pago a proveedor)', () => {
    const cfg = configDeLinea({ recordatorios: { activo: true } })
    expect(cfg.activo).toBe(true)
    expect(cfg.reglas.map((r) => r.id)).toEqual(['prov_t3', 'prov_t0', 'prov_vencido', 'toque_1', 'toque_3', 'toque_7'])
  })

  it('una regla de una fuente que aún no existe se salta sin contarse como error; una mal escrita se descarta', () => {
    const cfg = configDeLinea({
      recordatorios: {
        activo: true,
        reglas: [
          { id: 'cuota_t3', fuente: 'cuota', offset: -3, a: ['cliente'], canales: ['email'] },
          { id: 'mala', fuente: 'envio', offset: 1.5, a: ['responsable'], canales: ['in_app'] },
          { id: 'sin_canal', fuente: 'envio', offset: 1, a: ['responsable'], canales: ['paloma'] },
          { id: 'toque_1', fuente: 'envio', offset: 1, dias: 'habiles', etapa_numero: 3, a: ['responsable'], canales: ['in_app'] },
          { id: 'toque_1', fuente: 'envio', offset: 2, a: ['responsable'], canales: ['in_app'] },
        ],
      },
    })
    expect(cfg.reglas.map((r) => r.id)).toEqual(['toque_1'])
    expect(cfg.reglas[0]).toMatchObject({ dias: 'habiles', etapa_numero: 3 })
    expect(cfg.descartadas).toBe(3)
  })
})
