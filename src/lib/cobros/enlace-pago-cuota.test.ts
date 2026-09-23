import { describe, it, expect } from 'vitest'
import type { CobroRecibido, CuotaDeServicio } from '@/lib/valida-cda/pago-pendiente'
import {
  decidirEnlaceCuota,
  descripcionCuota,
  pasarelaDeEnlaces,
  type CobroProgramadoDeCuota,
  type CuotaParaEnlace,
} from './enlace-pago-cuota'

const AHORA = Date.parse('2026-09-20T15:00:00Z')
const HOY = '2026-09-20'

function cuotaFifo(numero: number, monto: number, fecha: string): CuotaDeServicio {
  return {
    cuotaId: `q${numero}`,
    numero,
    tipo: 'cuota',
    monto,
    fechaVencimiento: fecha,
    concepto: `Licencia VALIDA · Starter — periodo del ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/2026 al 22/10/2026`,
    enlacePagoUrl: null,
    enlacePagoExpira: null,
  }
}

const CUOTAS = [cuotaFifo(1, 250000, '2026-09-30'), cuotaFifo(2, 250000, '2026-10-30')]

function cuota(n: number): CuotaParaEnlace {
  const c = CUOTAS[n - 1]
  return { cuotaId: c.cuotaId!, numero: n, monto: c.monto, fechaVencimiento: c.fechaVencimiento, concepto: c.concepto, planCobroId: 'p1', totalCuotas: 12 }
}

function cobro(extra: Partial<CobroProgramadoDeCuota> = {}): CobroProgramadoDeCuota {
  return { id: 'c1', fecha: null, anuladoAt: null, monto: 250000, enlacePagoUrl: null, enlacePagoExpira: null, ...extra }
}

function decidir(n: number, c: CobroProgramadoDeCuota | null, cobros: CobroRecibido[] = []) {
  return decidirEnlaceCuota({ cuota: cuota(n), cobro: c, cuotas: CUOTAS, cobros, hoy: HOY, ahoraMs: AHORA })
}

describe('decidirEnlaceCuota', () => {
  it('sin cobro todavía: genera por el valor de la cuota', () => {
    expect(decidir(1, null)).toMatchObject({ accion: 'generar', monto: 250000 })
  })

  it('cuota pagada o cobro anulado: no hay enlace (cobraría dos veces)', () => {
    expect(decidir(1, cobro({ fecha: '2026-09-18' })).accion).toBe('rechazar')
    expect(decidir(1, cobro({ anuladoAt: '2026-09-18T00:00:00Z' })).accion).toBe('rechazar')
  })

  it('un enlace vigente no se regenera', () => {
    const d = decidir(1, cobro({ enlacePagoUrl: 'https://checkout.bold.co/LNK_A', enlacePagoExpira: '2026-09-27T23:59:00-05:00' }))
    expect(d).toEqual({ accion: 'vigente', url: 'https://checkout.bold.co/LNK_A', expira: '2026-09-27T23:59:00-05:00' })
  })

  it('un enlace vencido, o que vence en menos de una hora, se regenera', () => {
    expect(decidir(1, cobro({ enlacePagoUrl: 'https://checkout.bold.co/LNK_A', enlacePagoExpira: '2026-09-19T00:00:00Z' })).accion).toBe('generar')
    expect(decidir(1, cobro({ enlacePagoUrl: 'https://checkout.bold.co/LNK_A', enlacePagoExpira: '2026-09-20T15:30:00Z' })).accion).toBe('generar')
  })

  it('regla del excedente: lo pagado de más en la cuota 1 se descuenta del enlace de la 2', () => {
    const d = decidir(2, null, [{ monto: 250667, estado: 'pagado' }])
    expect(d).toMatchObject({ accion: 'generar', monto: 249333 })
  })

  it('una cuota que los pagos anteriores ya cubren no lleva enlace', () => {
    expect(decidir(2, null, [{ monto: 500000, estado: 'pagado' }]).accion).toBe('rechazar')
  })

  it('lo programado o anulado no cuenta como plata recibida', () => {
    const d = decidir(1, null, [{ monto: 250000, estado: 'programado' }, { monto: 250000, estado: 'anulado' }])
    expect(d).toMatchObject({ accion: 'generar', monto: 250000 })
  })
})

describe('descripcionCuota', () => {
  it('usa el concepto con el período si cabe', () => {
    expect(descripcionCuota(cuota(1))).toBe('Licencia VALIDA · Starter — periodo del 30/09/2026 al 22/10/2026')
  })

  it('si el concepto no cabe, deja el período; sin concepto, número y vencimiento', () => {
    const largo = `${'x'.repeat(120)} periodo del 23/09/2026 al 22/10/2026`
    expect(descripcionCuota({ numero: 3, concepto: largo, fechaVencimiento: '2026-11-30', totalCuotas: 12 })).toBe(
      'Cuota 3 · periodo del 23/09/2026 al 22/10/2026',
    )
    expect(descripcionCuota({ numero: 3, concepto: null, fechaVencimiento: '2026-11-30', totalCuotas: 12 })).toBe('Cuota 3 de 12 · vence 30/11/2026')
  })
})

describe('pasarelaDeEnlaces: la pasarela sale de un dato, no del código', () => {
  const generaEnlaces = (x: string) => x === 'bold' || x === 'epayco'

  it('manda el plan cuando su pasarela genera enlaces', () => {
    expect(pasarelaDeEnlaces({ pasarelaPlan: 'epayco', configWorkspace: { cobros: { pasarela_en_linea: 'bold' } }, generaEnlaces })).toBe('epayco')
  })

  it('un plan manual cae a la configuración de cobros del espacio', () => {
    expect(pasarelaDeEnlaces({ pasarelaPlan: 'manual', configWorkspace: { cobros: { pasarela_en_linea: 'bold' } }, generaEnlaces })).toBe('bold')
  })

  it('migrar de pasarela es cambiar ese valor', () => {
    expect(pasarelaDeEnlaces({ pasarelaPlan: 'manual', configWorkspace: { cobros: { pasarela_en_linea: 'epayco' } }, generaEnlaces })).toBe('epayco')
  })

  it('sin plan ni configuración útil no hay pasarela', () => {
    expect(pasarelaDeEnlaces({ pasarelaPlan: 'manual', configWorkspace: {}, generaEnlaces })).toBeNull()
    expect(pasarelaDeEnlaces({ pasarelaPlan: null, configWorkspace: null, generaEnlaces })).toBeNull()
    expect(pasarelaDeEnlaces({ pasarelaPlan: 'manual', configWorkspace: { cobros: { pasarela_en_linea: 'wompi' } }, generaEnlaces })).toBeNull()
  })
})
