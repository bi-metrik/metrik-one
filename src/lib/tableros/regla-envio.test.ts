import { describe, expect, it } from 'vitest'
import { horaCorteTexto, modoEnvio, reglaEnvio } from './regla-envio'

const base = { horas_desde_certificado: 48, horas_antes_cita: 36 }

describe('reglaEnvio', () => {
  it('sin modo (meses de antes de SOE-040) dice la regla de horas', () => {
    expect(modoEnvio(base)).toBe('horas_antes_cita')
    expect(reglaEnvio(base)).toBe(
      'Enviar dentro de 48 h del certificado bancario y al menos 36 h antes de la cita.')
  })

  it('en el modo nuevo dice la hora de corte y no menciona el certificado', () => {
    const r = reglaEnvio({ ...base, envio_modo: 'dia_habil_anterior', envio_hora_corte: 17 })
    expect(r).toBe('Enviar antes de las 17:00 del día hábil anterior a la cita.')
    expect(r).not.toMatch(/certificado/)
  })

  it('sin hora de corte cae a las 17:00', () => {
    expect(reglaEnvio({ ...base, envio_modo: 'dia_habil_anterior', envio_hora_corte: null }))
      .toContain('17:00')
  })

  it('formatea la hora con dos dígitos', () => {
    expect(horaCorteTexto(9)).toBe('09:00')
  })
})
