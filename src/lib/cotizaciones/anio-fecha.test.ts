import { describe, expect, it } from 'vitest'

import { deducirAnio, diaDeLaSemana, esAvisoDeAnioViejo, esFechaSinAnio, fechaSinDiaDeLaSemana } from './anio-fecha'

const HOY = '2026-09-23'
const base = { hoy: HOY, nombre: 'la fecha de salida' }

describe('el año de una fecha que la captura muestra sin él', () => {
  it('«Lun 23 Nov» es 2026: el 23 de noviembre de 2026 cae lunes, y no pide confirmar', () => {
    expect(deducirAnio({ ...base, valor: '--11-23/lun' })).toEqual({ fecha: '2026-11-23', aviso: null })
  })

  it('«Mié 25 Nov» es 2026', () => {
    expect(deducirAnio({ ...base, valor: '--11-25/mie' })).toEqual({ fecha: '2026-11-25', aviso: null })
  })

  it('el día de la semana manda: «Mar 23 Nov» es 2027, el primer año en que cae martes', () => {
    expect(deducirAnio({ ...base, valor: '--11-23/mar' })?.fecha).toBe('2027-11-23')
  })

  it('acepta el día con tilde, en inglés o en dos letras', () => {
    expect(deducirAnio({ ...base, valor: '--11-25/Mié' })?.fecha).toBe('2026-11-25')
    expect(deducirAnio({ ...base, valor: '--11-23 (Mon)' })?.fecha).toBe('2026-11-23')
    expect(diaDeLaSemana('Lu')).toBe(1)
    expect(diaDeLaSemana('xx')).toBeNull()
  })

  it('un día de la semana que no coincide en los dos años posibles: asume el primero y dice por qué', () => {
    const r = deducirAnio({ ...base, valor: '--11-23/dom' })
    expect(r?.fecha).toBe('2026-11-23')
    expect(r?.aviso).toContain('se asume 2026')
    expect(r?.aviso).toContain('dice domingo')
    expect(r?.aviso).toContain('ni en 2026 ni en 2027')
  })

  it('un regreso en enero después de una salida en diciembre es del año siguiente', () => {
    const salida = deducirAnio({ ...base, valor: '--12-28/lun' })!
    expect(salida).toEqual({ fecha: '2026-12-28', aviso: null })
    const regreso = deducirAnio({ ...base, valor: '--01-04/lun', noAntesDe: salida.fecha, nombre: 'la fecha de regreso' })
    expect(regreso).toEqual({ fecha: '2027-01-04', aviso: null })
    // Sin día de la semana, igual.
    expect(deducirAnio({ ...base, valor: '--01-04', noAntesDe: '2026-12-28' })?.fecha).toBe('2027-01-04')
  })

  it('cotizando a comienzos de enero un viaje de fin de año: el regreso no cae antes de la salida', () => {
    // Desde el 2 de enero, el 4 de enero de 2026 todavía es futuro; solo la salida lo descarta.
    const hoy = '2026-01-02'
    const salida = deducirAnio({ ...base, hoy, valor: '--12-28' })!
    expect(salida.fecha).toBe('2026-12-28')
    expect(deducirAnio({ ...base, hoy, valor: '--01-04', noAntesDe: salida.fecha })?.fecha).toBe('2027-01-04')
  })

  it('sin día de la semana: el año del viaje si la fecha cae en él', () => {
    const viaje = { inicio: '2026-12-29', fin: '2027-01-02' }
    expect(deducirAnio({ ...base, valor: '--12-29', viaje })).toEqual({ fecha: '2026-12-29', aviso: null })
    expect(deducirAnio({ ...base, valor: '--01-02', viaje, noAntesDe: '2026-12-29' })).toEqual({ fecha: '2027-01-02', aviso: null })
  })

  it('sin día ni viaje: la primera vez futura, nunca el año en curso (diciembre para un viaje de enero)', () => {
    expect(deducirAnio({ ...base, hoy: '2026-12-15', valor: '--01-10' })).toEqual({ fecha: '2027-01-10', aviso: null })
  })

  it('una fecha a más de 30 días de las del viaje sí pide confirmar, con el año asumido', () => {
    const r = deducirAnio({ ...base, valor: '--11-23/mar', viaje: { inicio: '2026-11-20', fin: '2026-11-27' } })
    expect(r?.fecha).toBe('2027-11-23')
    expect(r?.aviso).toContain('se asume 2027')
    expect(r?.aviso).toContain('más de 30 días')
  })

  it('una fecha con año no es asunto de esto; el día pegado se quita', () => {
    expect(deducirAnio({ ...base, valor: '2026-11-23' })).toBeNull()
    expect(esFechaSinAnio('2026-11-23')).toBe(false)
    expect(fechaSinDiaDeLaSemana('2026-11-23/lun')).toBe('2026-11-23')
    expect(fechaSinDiaDeLaSemana('2026-11-23')).toBe('2026-11-23')
  })

  it('el 29 de febrero cae en el próximo bisiesto', () => {
    expect(deducirAnio({ ...base, valor: '--02-29' })?.fecha).toBe('2028-02-29')
  })

  it('reconoce el aviso viejo («se completa con el del viaje») y ningún otro', () => {
    expect(esAvisoDeAnioViejo('La captura no muestra el año de salida y regreso: se completa con el del viaje (2026). Confírmalo.')).toBe(true)
    expect(esAvisoDeAnioViejo('La captura no muestra el año de la fecha de salida: se asume 2027 (23 nov 2027) porque …')).toBe(false)
  })
})
