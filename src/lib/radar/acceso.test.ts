/**
 * El día 6. Cada caso de aquí es una pregunta que el cliente va a hacer, y la respuesta cuesta plata
 * o cuesta un cliente:
 *
 *   · ¿hasta cuándo puedo probar? (5 días desde la aceptación, ni uno más)
 *   · ¿qué pasa el día 6 si no pagué? (se cierra, con el enlace a la vista)
 *   · ¿y si el cron no alcanzó a emitir la cuota? (se cierra igual: eso no extiende el trial)
 *   · ¿y si pagué? (sigue abierto hasta el próximo vencimiento)
 */
import { describe, expect, it } from 'vitest'
import {
  avisoTrialRadar,
  estadoAccesoRadar,
  mensajeRadarCerrado,
  radarAbierto,
  textoBannerTrial,
  type CuotaDelRadar,
} from './acceso'

const ACEPTACION = '2026-09-29'
const FIN_TRIAL = '2026-10-04'

const cuota = (p: Partial<CuotaDelRadar> = {}): CuotaDelRadar => ({
  numero: 1,
  fechaVencimiento: FIN_TRIAL,
  pagada: false,
  saldo: 15_000,
  enlace: 'https://checkout.bold.co/abc',
  ...p,
})

const acceso = (p: Parameters<typeof estadoAccesoRadar>[0] extends infer T ? Partial<T> : never) =>
  estadoAccesoRadar({
    contrato: { estado: 'activo', diasTrial: 5 },
    fechaAceptacion: ACEPTACION,
    cuotas: [cuota()],
    hoy: '2026-09-30',
    ...p,
  })

describe('el trial son 5 días desde la aceptación', () => {
  it('el día de la aceptación y los cuatro siguientes están en trial', () => {
    for (const hoy of ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']) {
      const a = acceso({ hoy })
      expect(a.estado, hoy).toBe('en_trial')
      expect(a.estado === 'en_trial' && a.finTrial).toBe(FIN_TRIAL)
      expect(radarAbierto(a), hoy).toBe(true)
    }
  })

  it('el banner cuenta días completos restantes, calculados aquí y no en el navegador', () => {
    // Aceptó el 29-sep: el 29 quedan 5, el 3-oct queda 1 (hoy) y el 4-oct ya no hay banner porque
    // el módulo está cerrado.
    expect(avisoTrialRadar(acceso({ hoy: '2026-09-29' }))).toBe('Te quedan 5 días de prueba del Radar.')
    expect(avisoTrialRadar(acceso({ hoy: '2026-10-02' }))).toBe('Te quedan 2 días de prueba del Radar.')
    expect(avisoTrialRadar(acceso({ hoy: '2026-10-03' }))).toBe(
      'Hoy es el último día de tu prueba: mañana se cierra el Radar si no registras el pago.',
    )
    expect(avisoTrialRadar(acceso({ hoy: '2026-10-04' }))).toBeNull()
  })

  it('los tramos del banner: 5 a 2 días cuentan, el último día se nombra', () => {
    expect(textoBannerTrial(5)).toBe('Te quedan 5 días de prueba del Radar.')
    expect(textoBannerTrial(2)).toBe('Te quedan 2 días de prueba del Radar.')
    // Con 1 día restante, hoy es el último día de uso Y mañana vence: se dicen las dos cosas, en
    // vez de inventar un sexto día de prueba.
    expect(textoBannerTrial(1)).toContain('Hoy es el último día de tu prueba')
    expect(textoBannerTrial(1)).toContain('mañana se cierra')
    // Un número raro no produce un banner que diga «Te quedan 0 días».
    expect(textoBannerTrial(0)).toContain('Hoy es el último día')
    expect(textoBannerTrial(-3)).toContain('Hoy es el último día')
  })

  it('un `dias_trial` distinto mueve la fecha, y es la única forma de moverla', () => {
    const a = acceso({ contrato: { estado: 'activo', diasTrial: 15 }, hoy: '2026-10-10' })
    expect(a.estado).toBe('en_trial')
    expect(a.estado === 'en_trial' && a.finTrial).toBe('2026-10-14')
  })
})

describe('el día 6, sin pago, el módulo se cierra', () => {
  it('la cuota que vence el día del fin del trial y no está pagada cierra el Radar', () => {
    const a = acceso({ hoy: FIN_TRIAL })
    expect(a).toMatchObject({ estado: 'cerrado', motivo: 'trial_vencido', desde: FIN_TRIAL })
    expect(radarAbierto(a)).toBe(false)
    expect(a.estado === 'cerrado' && a.cuota?.enlace).toBe('https://checkout.bold.co/abc')
  })

  it('el mensaje le dice qué pasó y dónde pagar, sin hablar de mora', () => {
    const a = acceso({ hoy: FIN_TRIAL })
    if (a.estado !== 'cerrado') throw new Error('debía cerrar')
    expect(mensajeRadarCerrado(a)).toBe(
      'Tu prueba del Radar terminó el 4-oct. Para seguir usándolo, paga con el enlace de la pantalla del Radar.',
    )
  })

  it('SIN cuota emitida también cierra: que el cron no enrolara no extiende el trial', () => {
    const a = acceso({ cuotas: [], hoy: FIN_TRIAL })
    expect(a).toMatchObject({ estado: 'cerrado', motivo: 'trial_vencido', desde: FIN_TRIAL, cuota: null })
  })

  it('un contrato pausado por mora sigue midiéndose igual (pausado es justo el que debe)', () => {
    const a = acceso({ contrato: { estado: 'pausado', diasTrial: 5 }, hoy: FIN_TRIAL })
    expect(a.estado).toBe('cerrado')
  })

  it('sigue cerrado al mes siguiente, y ahí el motivo ya no es el trial', () => {
    const a = acceso({
      cuotas: [cuota({ pagada: true }), cuota({ numero: 2, fechaVencimiento: '2026-11-04' })],
      hoy: '2026-11-10',
    })
    expect(a).toMatchObject({ estado: 'cerrado', motivo: 'cuota_vencida', desde: '2026-11-04' })
    if (a.estado !== 'cerrado') return
    expect(mensajeRadarCerrado(a)).toContain('pago vencido desde el 4-nov')
  })

  it('con dos cuotas vencidas impagas, el corte se cuenta desde la más vieja', () => {
    const a = acceso({
      cuotas: [cuota(), cuota({ numero: 2, fechaVencimiento: '2026-11-04' })],
      hoy: '2026-11-10',
    })
    expect(a).toMatchObject({ estado: 'cerrado', desde: FIN_TRIAL })
  })
})

describe('pagando sigue abierto', () => {
  it('la cuota del fin del trial pagada deja el Radar abierto hasta el próximo vencimiento', () => {
    const a = acceso({
      cuotas: [cuota({ pagada: true, saldo: 0 }), cuota({ numero: 2, fechaVencimiento: '2026-11-04' })],
      hoy: '2026-10-20',
    })
    expect(a).toEqual({ estado: 'al_dia', cubiertoHasta: '2026-11-04' })
    expect(radarAbierto(a)).toBe(true)
  })

  it('el día en que vence la cuota siguiente, si está pagada, sigue abierto', () => {
    const a = acceso({
      cuotas: [cuota({ pagada: true }), cuota({ numero: 2, fechaVencimiento: '2026-11-04', pagada: true })],
      hoy: '2026-11-04',
    })
    expect(a.estado).toBe('al_dia')
  })

  it('una cuota futura impaga no cierra nada', () => {
    const a = acceso({
      cuotas: [cuota({ pagada: true }), cuota({ numero: 2, fechaVencimiento: '2026-11-04', pagada: false })],
      hoy: '2026-10-31',
    })
    expect(a.estado).toBe('al_dia')
  })
})

describe('los casos en que esto no decide nada', () => {
  it('sin contrato de Radar el módulo queda abierto: no hay nada que cobrar', () => {
    expect(acceso({ contrato: null, hoy: '2027-01-01' })).toEqual({ estado: 'sin_contrato' })
  })

  it('un contrato cancelado o terminado no cierra el módulo por pago: eso se apaga por otro lado', () => {
    for (const estado of ['borrador', 'cancelado', 'terminado']) {
      expect(acceso({ contrato: { estado, diasTrial: 5 }, hoy: '2027-01-01' }), estado).toEqual({
        estado: 'sin_contrato',
      })
    }
  })

  it('sin aceptación no se mide el trial: de eso se encarga el gate de términos', () => {
    expect(acceso({ fechaAceptacion: null, hoy: '2027-01-01' })).toEqual({ estado: 'sin_aceptacion' })
  })

  it('sin `dias_trial` en ninguna fuente NO se asume 0: un dato ausente no cierra el módulo', () => {
    expect(acceso({ contrato: { estado: 'activo', diasTrial: null }, hoy: '2027-01-01' })).toEqual({
      estado: 'sin_aceptacion',
    })
  })

  it('`no_disponible` no cierra: no poder leer las cuotas no es no haber pagado', () => {
    expect(radarAbierto({ estado: 'no_disponible' })).toBe(true)
  })
})
