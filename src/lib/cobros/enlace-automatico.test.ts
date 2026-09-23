import { describe, it, expect } from 'vitest'
import {
  limiteVentana,
  planesConEnlaceAutomatico,
  seleccionarCuotasParaEnlace,
  sumarDias,
  type CobroParaSeleccion,
  type PlanParaEnlace,
} from './enlace-automatico'

const HOY = '2026-09-25'
const AHORA = Date.parse('2026-09-25T12:00:00Z')
const PLAN: PlanParaEnlace = { id: 'plan1', workspaceId: 'wsM', negocioId: 'n1', pasarela: 'bold' }

function cuota(numero: number, fechaVencimiento: string) {
  return { id: `q${numero}`, planCobroId: 'plan1', numero, fechaVencimiento }
}
function cobro(numero: number, extra: Partial<CobroParaSeleccion> = {}): CobroParaSeleccion {
  return {
    planCobroId: 'plan1',
    numeroCuota: numero,
    tipoCobro: 'programado',
    fecha: null,
    anuladoAt: null,
    enlacePagoUrl: null,
    enlacePagoExpira: null,
    ...extra,
  }
}
function seleccionar(cuotas: ReturnType<typeof cuota>[], cobros: CobroParaSeleccion[] = []) {
  return seleccionarCuotasParaEnlace({ planes: [PLAN], cuotas, cobros, hoy: HOY, ahoraMs: AHORA })
}
const ids = (s: ReturnType<typeof seleccionar>) => s.candidatas.map((c) => c.cuotaId)

describe('ventana de 7 días', () => {
  it('suma días de calendario cruzando el mes', () => {
    expect(sumarDias('2026-09-25', 7)).toBe('2026-10-02')
    expect(limiteVentana('2026-12-28')).toBe('2027-01-04')
  })

  it('entra la que vence a 7 días justos; no la que vence a 8', () => {
    expect(ids(seleccionar([cuota(1, '2026-10-02'), cuota(2, '2026-10-03')]))).toEqual(['q1'])
  })

  it('entran las ya vencidas mientras sigan sin pagar, primero la más vieja', () => {
    expect(ids(seleccionar([cuota(2, '2026-09-20'), cuota(1, '2026-08-20')]))).toEqual(['q1', 'q2'])
  })
})

describe('qué cuotas se descartan', () => {
  it('pagada o anulada no reciben enlace', () => {
    const s = seleccionar(
      [cuota(1, '2026-09-20'), cuota(2, '2026-09-28')],
      [cobro(1, { fecha: '2026-09-19' }), cobro(2, { anuladoAt: '2026-09-21T00:00:00Z' })],
    )
    expect(ids(s)).toEqual([])
    expect(s.descartadas).toEqual([
      { cuotaId: 'q1', motivo: 'pagada' },
      { cuotaId: 'q2', motivo: 'anulada' },
    ])
  })

  it('un enlace vigente no se regenera; uno vencido o a menos de una hora de vencer sí', () => {
    const s = seleccionar(
      [cuota(1, '2026-09-26'), cuota(2, '2026-09-27'), cuota(3, '2026-09-28'), cuota(4, '2026-09-29')],
      [
        cobro(1, { enlacePagoUrl: 'https://pay/1', enlacePagoExpira: '2026-09-30T00:00:00Z' }),
        cobro(2, { enlacePagoUrl: 'https://pay/2', enlacePagoExpira: '2026-09-24T00:00:00Z' }),
        cobro(3, { enlacePagoUrl: 'https://pay/3', enlacePagoExpira: '2026-09-25T12:30:00Z' }),
        // Sin fecha de vencimiento se trata como vigente, igual que el botón.
        cobro(4, { enlacePagoUrl: 'https://pay/4', enlacePagoExpira: null }),
      ],
    )
    expect(ids(s)).toEqual(['q2', 'q3'])
    expect(s.descartadas.map((d) => d.motivo)).toEqual(['enlace_vigente', 'enlace_vigente'])
  })

  it('solo el cobro PROGRAMADO de la cuota cuenta; un pago suelto con el mismo número no la descarta', () => {
    const s = seleccionar([cuota(1, '2026-09-26')], [cobro(1, { tipoCobro: 'pago', fecha: '2026-09-01' })])
    expect(ids(s)).toEqual(['q1'])
  })

  it('cuotas de un plan que no está en la lista no se tocan', () => {
    const s = seleccionarCuotasParaEnlace({
      planes: [PLAN],
      cuotas: [{ id: 'x', planCobroId: 'otro', numero: 1, fechaVencimiento: '2026-09-26' }],
      cobros: [],
      hoy: HOY,
      ahoraMs: AHORA,
    })
    expect(s.candidatas).toEqual([])
  })
})

describe('qué planes entran', () => {
  const generaEnlaces = (x: string) => x === 'bold'
  const contrato = (estado: string, negocioId = 'n1', workspaceId = 'wsM') => ({ estado, negocioId, workspaceId })

  it('un plan con contrato activo o pausado y pasarela real entra, aunque el plan esté inactivo', () => {
    const r = planesConEnlaceAutomatico({
      contratos: [contrato('pausado')],
      planes: [PLAN],
      configPorWorkspace: new Map(),
      generaEnlaces,
    })
    expect(r.map((p) => p.id)).toEqual(['plan1'])
  })

  it('contrato en borrador, cancelado o terminado: no', () => {
    for (const estado of ['borrador', 'cancelado', 'terminado']) {
      const r = planesConEnlaceAutomatico({ contratos: [contrato(estado)], planes: [PLAN], configPorWorkspace: new Map(), generaEnlaces })
      expect(r, estado).toEqual([])
    }
  })

  it('el contrato tiene que ser del mismo espacio y del mismo negocio', () => {
    const r = planesConEnlaceAutomatico({
      contratos: [contrato('activo', 'n1', 'otroWs'), contrato('activo', 'n2')],
      planes: [PLAN],
      configPorWorkspace: new Map(),
      generaEnlaces,
    })
    expect(r).toEqual([])
  })

  it('plan manual: entra solo si el espacio declara una pasarela en línea real', () => {
    const manual = { ...PLAN, pasarela: 'manual' }
    const base = { contratos: [contrato('activo')], planes: [manual], generaEnlaces }
    expect(planesConEnlaceAutomatico({ ...base, configPorWorkspace: new Map() })).toEqual([])
    expect(planesConEnlaceAutomatico({ ...base, configPorWorkspace: new Map([['wsM', { cobros: { pasarela_en_linea: 'manual' } }]]) })).toEqual([])
    expect(
      planesConEnlaceAutomatico({ ...base, configPorWorkspace: new Map([['wsM', { cobros: { pasarela_en_linea: 'bold' } }]]) }).map((p) => p.id),
    ).toEqual(['plan1'])
  })
})
