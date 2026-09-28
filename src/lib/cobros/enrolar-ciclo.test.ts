/**
 * El ancla del trial y el calendario del primer año. Esto es plata: cada caso de aquí es uno que,
 * si se rompe, cobra antes de tiempo, cobra dos veces o no cobra nunca.
 *
 * Los cuatro que el encargo pide explícitamente:
 *   · el ancla es la ACEPTACIÓN (y el día es el de Bogotá, no el UTC);
 *   · el trial no se extiende solo (ni por aceptar de nuevo, ni recalculando desde hoy);
 *   · no se cobra dos veces el mismo ciclo (acta o plan previo → no se enrola);
 *   · la cuota 1 vence el día en que el trial termina (día 6 con trial de 5).
 */
import { describe, expect, it } from 'vitest'
import {
  CUOTAS_POR_ENROLAMIENTO,
  cuotasDelCiclo,
  diaMes,
  finDelTrial,
  planearEnrolamiento,
  sumarMeses,
  type ContratoCandidato,
} from './enrolar-ciclo'
import { leerPeriodoEnConcepto } from './periodo-en-concepto'

const FABRI: ContratoCandidato = {
  id: 'c-radar',
  workspaceId: 'ws-metrik',
  negocioId: 'n-fabri',
  estado: 'activo',
  servicioSlug: 'radar-secop-licencia',
  nombreServicio: 'Licencia Radar SECOP',
  modulo: 'radar_secop',
  disparadorCobro: 'ciclo',
  // El descuento de fundador vive en el contrato, no en la ficha.
  parametros: { precio_mensual: 15_000, dias_trial: 5 },
  diasTrialFicha: 5,
  anclaAt: '2026-09-29T14:30:00Z',
  yaEnrolado: false,
  tienePlan: false,
  pasarela: 'bold',
}

const enrolar = (c: Partial<ContratoCandidato> = {}) => planearEnrolamiento({ ...FABRI, ...c })

describe('el ancla del trial es la aceptación de los términos', () => {
  it('con 5 días, la cuota 1 vence el sexto día contado desde la aceptación', () => {
    const r = enrolar()
    expect(r.tipo).toBe('enrolar')
    if (r.tipo !== 'enrolar') return
    // Aceptó el 29-sep → opera el 29, 30, 1, 2 y 3 (cinco días) y el 4-oct tiene que pagar.
    expect(r.finTrial).toBe('2026-10-04')
    expect(r.cuotas[0].fecha_vencimiento).toBe('2026-10-04')
    expect(r.plan.fecha_inicio).toBe('2026-10-04')
  })

  it('el día que cuenta es el de BOGOTÁ: una aceptación a las 21:00 no regala un día', () => {
    // 2026-09-29T02:00Z = 21:00 del 28-sep en Bogotá. El cliente aceptó el 28.
    expect(finDelTrial('2026-09-29T02:00:00Z', 5)).toBe('2026-10-03')
    // Y a las 19:00 UTC del mismo día sigue siendo el 29 en Bogotá (14:00).
    expect(finDelTrial('2026-09-29T19:00:00Z', 5)).toBe('2026-10-04')
  })

  it('NO se calcula desde hoy: un contrato que aceptó hace un mes nace con la cuota vencida', () => {
    const r = enrolar({ anclaAt: '2026-08-20T15:00:00Z' })
    expect(r.tipo === 'enrolar' && r.finTrial).toBe('2026-08-25')
  })

  it('un trial de 0 días cobra el mismo día de la aceptación, y eso es legítimo', () => {
    const r = enrolar({ parametros: { precio_mensual: 20_000, dias_trial: 0 } })
    expect(r.tipo === 'enrolar' && r.finTrial).toBe('2026-09-29')
  })

  it('sin aceptación no hay trial que anclar: no se enrola', () => {
    expect(enrolar({ anclaAt: null })).toEqual({ tipo: 'no', motivo: 'sin_aceptacion' })
  })
})

describe('el trial no se extiende solo', () => {
  it('el ancla que llega es la aceptación más vieja: aceptar otra versión no corre la fecha', () => {
    // El servidor pasa el MIN(respondido_at); esta prueba fija que el cálculo no hace nada raro
    // con una aceptación posterior, y el servidor tiene su propia prueba de que elige la vieja.
    const primera = enrolar({ anclaAt: '2026-09-29T14:30:00Z' })
    const segunda = enrolar({ anclaAt: '2026-10-15T14:30:00Z' })
    expect(primera.tipo === 'enrolar' && primera.finTrial).toBe('2026-10-04')
    expect(segunda.tipo === 'enrolar' && segunda.finTrial).toBe('2026-10-20')
    // O sea: si el servidor pasara la aceptación NUEVA, el trial se habría corrido 16 días. Por eso
    // `anclaAt` es un MIN y no un MAX.
  })

  it('un `dias_trial` del contrato manda sobre el de la ficha, pero tiene que estar escrito', () => {
    expect(enrolar({ parametros: { precio_mensual: 15_000, dias_trial: 30 } }).tipo === 'enrolar').toBe(true)
    const r = enrolar({ parametros: { precio_mensual: 15_000, dias_trial: 30 } })
    expect(r.tipo === 'enrolar' && r.finTrial).toBe('2026-10-29')
  })

  it('sin `dias_trial` en el contrato usa el de la ficha; sin ninguno de los dos, no se enrola', () => {
    const conFicha = enrolar({ parametros: { precio_mensual: 15_000 } })
    expect(conFicha.tipo === 'enrolar' && conFicha.finTrial).toBe('2026-10-04')
    expect(enrolar({ parametros: { precio_mensual: 15_000 }, diasTrialFicha: null })).toEqual({
      tipo: 'no',
      motivo: 'sin_dias_trial',
    })
  })
})

describe('no se cobra dos veces el mismo ciclo', () => {
  it('un contrato con acta de enrolamiento no se vuelve a enrolar', () => {
    expect(enrolar({ yaEnrolado: true })).toEqual({ tipo: 'no', motivo: 'ya_enrolado' })
  })

  it('un negocio que ya tiene plan de cobro (cargado a mano) no recibe otro', () => {
    expect(enrolar({ tienePlan: true })).toEqual({ tipo: 'no', motivo: 'plan_existente' })
  })

  it('el calendario no repite vencimientos ni números', () => {
    const r = enrolar()
    if (r.tipo !== 'enrolar') throw new Error('debía enrolar')
    expect(new Set(r.cuotas.map((c) => c.numero)).size).toBe(CUOTAS_POR_ENROLAMIENTO)
    expect(new Set(r.cuotas.map((c) => c.fecha_vencimiento)).size).toBe(CUOTAS_POR_ENROLAMIENTO)
    expect(r.cuotas.map((c) => c.numero)).toEqual([...Array(CUOTAS_POR_ENROLAMIENTO)].map((_, i) => i + 1))
  })
})

describe('el alcance: un solo módulo', () => {
  it('un contrato de otro módulo por ciclo NO se enrola, aunque cumpla todo lo demás', () => {
    // Las licencias de Clarity, Sustenta y de los CDA tienen sus planes cargados a mano: enrolarlas
    // aquí emitiría cobros que nadie autorizó.
    for (const modulo of ['business', 'valida_consulta', 'compliance']) {
      expect(enrolar({ modulo }), modulo).toEqual({ tipo: 'no', motivo: 'modulo_no_automatico' })
    }
  })

  it('un servicio por consumo no entra ni siendo del módulo', () => {
    expect(enrolar({ disparadorCobro: 'consumo' })).toEqual({ tipo: 'no', motivo: 'no_es_por_ciclo' })
  })

  it('solo un contrato activo: borrador, pausado, cancelado y terminado no se enrolan', () => {
    for (const estado of ['borrador', 'pausado', 'cancelado', 'terminado']) {
      expect(enrolar({ estado }), estado).toEqual({ tipo: 'no', motivo: 'estado' })
    }
  })
})

describe('el precio y la pasarela', () => {
  it('el precio sale del contrato, no de la ficha: sin él no se enrola (no se cobra de lista)', () => {
    expect(enrolar({ parametros: { dias_trial: 5 } })).toEqual({ tipo: 'no', motivo: 'sin_precio' })
    expect(enrolar({ parametros: { precio_mensual: 0, dias_trial: 5 } })).toEqual({ tipo: 'no', motivo: 'sin_precio' })
    expect(enrolar({ parametros: null })).toEqual({ tipo: 'no', motivo: 'sin_precio' })
  })

  it('el monto de cada cuota es el precio pactado, no el de lista', () => {
    const r = enrolar()
    if (r.tipo !== 'enrolar') throw new Error('debía enrolar')
    expect(r.plan.monto).toBe(15_000)
    expect(r.cuotas.every((c) => c.monto === 15_000)).toBe(true)
  })

  it('sin pasarela en línea no se enrola: un plan sin enlace deja al cliente sin nada que oprimir', () => {
    expect(enrolar({ pasarela: null })).toEqual({ tipo: 'no', motivo: 'sin_pasarela' })
  })
})

describe('el calendario del primer año', () => {
  it('son 12 cuotas mensuales y el plan termina en la última', () => {
    const r = enrolar()
    if (r.tipo !== 'enrolar') throw new Error('debía enrolar')
    expect(r.cuotas).toHaveLength(12)
    expect(r.plan.total_cuotas).toBe(12)
    expect(r.cuotas.map((c) => c.fecha_vencimiento)).toEqual([
      '2026-10-04', '2026-11-04', '2026-12-04', '2027-01-04', '2027-02-04', '2027-03-04',
      '2027-04-04', '2027-05-04', '2027-06-04', '2027-07-04', '2027-08-04', '2027-09-04',
    ])
    expect(r.plan.fecha_fin).toBe('2027-09-04')
  })

  it('el día 31 se topa al último del mes: no salta de mes', () => {
    expect(sumarMeses('2026-01-31', 1)).toBe('2026-02-28')
    expect(sumarMeses('2028-01-31', 1)).toBe('2028-02-29')
    expect(sumarMeses('2026-03-31', 1)).toBe('2026-04-30')
    // Y el tope no se arrastra: a partir del ancla siempre se cuenta desde el día original.
    const c = cuotasDelCiclo({ finTrial: '2026-01-31', monto: 1000, total: 4, nombreServicio: 'X' })
    expect(c.map((x) => x.fecha_vencimiento)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })

  it('el concepto de cada cuota trae el período que paga, y lo lee el mismo parser de la pantalla', () => {
    const r = enrolar()
    if (r.tipo !== 'enrolar') throw new Error('debía enrolar')
    expect(r.cuotas[0].concepto_detalle).toBe(
      'Suscripción Licencia Radar SECOP — servicio de computación en la nube (SaaS) · periodo del 4-oct al 3-nov',
    )
    const periodo = leerPeriodoEnConcepto(r.cuotas[0].concepto_detalle, r.cuotas[0].fecha_vencimiento)
    expect(periodo?.desde).toBe('2026-10-04')
    expect(periodo?.hasta).toBe('2026-11-03')
  })

  it('los períodos de dos cuotas seguidas no se solapan ni dejan huecos', () => {
    const r = enrolar()
    if (r.tipo !== 'enrolar') throw new Error('debía enrolar')
    for (let i = 1; i < r.cuotas.length; i++) {
      const anterior = leerPeriodoEnConcepto(r.cuotas[i - 1].concepto_detalle, r.cuotas[i - 1].fecha_vencimiento)
      expect(anterior?.hasta, `cuota ${i}`).toBe(
        new Date(Date.parse(`${r.cuotas[i].fecha_vencimiento}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10),
      )
    }
  })

  it('diaMes escribe el mes como lo espera el parser del concepto', () => {
    expect(diaMes('2026-10-04')).toBe('4-oct')
    expect(diaMes('2026-01-31')).toBe('31-ene')
  })
})
