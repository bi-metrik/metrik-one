import { describe, expect, it } from 'vitest'
import { proximoPago, type CuotaDeServicio } from './pago-pendiente'
import {
  enPlazoParaAceptar,
  estadoMora,
  fechaDiaMes,
  mensajeSuspendidoPorMora,
  sumarDias,
  textoAvisoMora,
  textoAvisoPlazo,
} from './plazos'

/**
 * Las dos fechas que deciden si un CDA opera Valida, con las fechas límite del encargo
 * (2026-09-23): plazo para aceptar hasta el 30-sep, y la primera cuota de los CDA, que vence el
 * 30-sep (medida en producción ese día).
 */

const cuota = (numero: number, fechaVencimiento: string): CuotaDeServicio => ({
  numero,
  tipo: 'cuota',
  monto: 150000,
  fechaVencimiento,
  concepto: `Licencia VALIDA · Starter — cuota ${numero}`,
  enlacePagoUrl: null,
  enlacePagoExpira: null,
})
const CUOTAS = [cuota(1, '2026-09-30'), cuota(2, '2026-10-27'), cuota(3, '2026-11-27')]
const moraEl = (hoy: string, pagado = 0) =>
  estadoMora(
    proximoPago({
      cuotas: CUOTAS,
      cobros: pagado > 0 ? [{ monto: pagado, estado: 'pagado' }] : [],
      hoy,
      ahoraISO: `${hoy}T15:00:00Z`,
    }),
    hoy,
  )

describe('plazo para aceptar los términos', () => {
  it('con plazo 30-sep: el 30-sep todavía opera, el 1-oct ya no', () => {
    expect(enPlazoParaAceptar('2026-09-30', '2026-09-23')).toBe(true)
    expect(enPlazoParaAceptar('2026-09-30', '2026-09-30')).toBe(true)
    expect(enPlazoParaAceptar('2026-09-30', '2026-10-01')).toBe(false)
    expect(enPlazoParaAceptar('2026-09-30', '2026-10-30')).toBe(false)
  })

  it('sin plazo (null) no hay gracia: se pausa de inmediato, como hasta hoy', () => {
    expect(enPlazoParaAceptar(null, '2026-09-23')).toBe(false)
    expect(enPlazoParaAceptar(undefined, '2026-09-23')).toBe(false)
  })

  it('una fecha ilegible no abre: se lee como sin plazo', () => {
    expect(enPlazoParaAceptar('30/09/2026', '2026-09-23')).toBe(false)
    expect(enPlazoParaAceptar('', '2026-09-23')).toBe(false)
  })

  it('el aviso dice que el servicio se suspende al terminar el último día del plazo', () => {
    expect(textoAvisoPlazo('2026-09-27')).toBe(
      'El servicio de Valida se suspenderá al terminar el 27-sep si la persona designada por tu empresa no ha aceptado los Términos.',
    )
    // El último día del aviso es el mismo que todavía opera: el 27 abre, el 28 no.
    expect(enPlazoParaAceptar('2026-09-27', '2026-09-27')).toBe(true)
    expect(enPlazoParaAceptar('2026-09-27', '2026-09-28')).toBe(false)
  })
})

describe('mora por pago (cláusula 11.1): cuota que vence el 30-sep', () => {
  it('30-sep, el día del vencimiento: nada que avisar a todos, nada que pausar', () => {
    expect(moraEl('2026-09-30')).toEqual({ estado: 'al_dia' })
  })

  it('1-oct: vencida, aviso con la fecha de corte 31-oct, pero opera', () => {
    expect(moraEl('2026-10-01')).toEqual({ estado: 'en_mora', vencio: '2026-09-30', corteDesde: '2026-10-31' })
  })

  it('30-oct: todavía dentro de los 30 días, sigue el aviso', () => {
    expect(moraEl('2026-10-30')).toEqual({ estado: 'en_mora', vencio: '2026-09-30', corteDesde: '2026-10-31' })
  })

  it('31-oct: más de 30 días de mora, Valida se pausa', () => {
    expect(moraEl('2026-10-31')).toEqual({ estado: 'suspendido', vencio: '2026-09-30', corteDesde: '2026-10-31' })
  })

  it('se mide sobre la cuota impaga MÁS VIEJA: con la 1 pagada, el 31-oct no pausa (la 2 vence el 27-oct)', () => {
    expect(moraEl('2026-10-31', 150000)).toEqual({ estado: 'en_mora', vencio: '2026-10-27', corteDesde: '2026-11-27' })
  })

  it('un abono parcial no saca de la mora: la cuota sigue impaga', () => {
    expect(moraEl('2026-10-31', 100000).estado).toBe('suspendido')
  })

  it('al día o sin cuotas, nunca hay mora', () => {
    expect(moraEl('2026-12-31', 450000)).toEqual({ estado: 'al_dia' })
    expect(estadoMora({ estado: 'sin_cuotas' }, '2026-12-31')).toEqual({ estado: 'al_dia' })
  })

  it('los textos nombran las fechas y la cláusula, sin montos', () => {
    const m = moraEl('2026-10-01')
    if (m.estado !== 'en_mora') throw new Error('se esperaba mora')
    expect(textoAvisoMora(m)).toBe(
      'Hay un pago de la suscripción vencido desde el 30-sep. Si no se registra, Valida se pausa desde el 31-oct (cláusula 11.1 de los términos).',
    )
    const s = moraEl('2026-10-31')
    if (s.estado !== 'suspendido') throw new Error('se esperaba suspensión')
    expect(mensajeSuspendidoPorMora(s)).toContain('pausada desde el 31-oct')
    expect(mensajeSuspendidoPorMora(s)).not.toMatch(/\$|150/)
  })
})

describe('fechas', () => {
  it('suma días cruzando mes y año sin correrse por zona horaria', () => {
    expect(sumarDias('2026-09-30', 30)).toBe('2026-10-30')
    expect(sumarDias('2026-09-30', 31)).toBe('2026-10-31')
    expect(sumarDias('2026-12-15', 30)).toBe('2027-01-14')
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('día-mes corto en español', () => {
    expect(fechaDiaMes('2026-09-30')).toBe('30-sep')
    expect(fechaDiaMes('2026-10-01')).toBe('1-oct')
    expect(fechaDiaMes('no-es-fecha')).toBe('no-es-fecha')
  })
})
