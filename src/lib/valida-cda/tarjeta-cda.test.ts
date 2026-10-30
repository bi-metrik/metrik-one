import { describe, expect, it } from 'vitest'
import type { DocumentoContractual } from '@/lib/valida-api/resultados'
import type { CuotaConEstado } from './pago-pendiente'
import {
  CALENDARIO_TARJETA_CDA,
  cuotasACobrarCda,
  diaDeRenovacion,
  elegibilidadTarjeta,
  entraAlCobroAutomatico,
  fechasDelFallo,
  inicioDelPeriodo,
  intentoDelDiaCda,
  pendienteCobrableConTarjeta,
  pendientesFueraDeLaTarjeta,
  proximoCobroTarjeta,
  siguienteFechaDeRenovacion,
  textoAutorizacionTarjeta,
  textoConfirmacionPendiente,
  textoFalloTarjeta,
  textoPendiente,
  textoTarjetaActiva,
  v15DelEspacio,
} from './tarjeta-cda'

const PLAN = 'Suscripción VALIDA · Plan CDA — mensual'
const cuotaPlan = (numero: number, desde: string, hasta: string, vence: string, monto = 150000) => ({
  id: `q${numero}`,
  numero,
  monto,
  fechaVencimiento: vence,
  concepto: `${PLAN} · periodo del ${desde} al ${hasta}`,
})

// Caquetá a fin de octubre: debe el 23-sep y el 23-oct; el 23-nov ya está creado.
const CUOTAS = [
  cuotaPlan(1, '23-sep', '22-oct', '2026-09-30'),
  cuotaPlan(2, '23-oct', '22-nov', '2026-10-27'),
  cuotaPlan(3, '23-nov', '22-dic', '2026-11-27'),
  cuotaPlan(4, '23-dic', '22-ene', '2026-12-27'),
]

function conEstado(c: (typeof CUOTAS)[number], estado: CuotaConEstado['estado'], abonado = 0): CuotaConEstado {
  return {
    cuotaId: c.id,
    numero: c.numero,
    concepto: c.concepto,
    fechaVencimiento: c.fechaVencimiento,
    monto: c.monto,
    abonado,
    saldo: estado === 'pagada' ? 0 : c.monto - abonado,
    estado,
    enlacePago: null,
    factura: null,
    ultimoPago: null,
  } as CuotaConEstado
}

describe('la autorización (2.4): el día sale del dato', () => {
  it('el texto exacto, con el día de renovación del CDA', () => {
    expect(textoAutorizacionTarjeta(23)).toBe(
      'Autorizo que el valor de cada período se cobre a esta tarjeta en la fecha de renovación (el 23 de cada mes) y, si no pasa, dentro de los 5 días siguientes (Términos v1.5, 2.4).',
    )
    expect(textoAutorizacionTarjeta(9)).toContain('(el 9 de cada mes)')
  })

  it('el día es el del texto registrado de la v1.5; sin él, el inicio del período de la última cuota', () => {
    const doc = { textoMd: 'La fecha de renovación del Cliente es el día 21 de cada mes.' }
    expect(diaDeRenovacion(doc, CUOTAS)).toBe(21)
    expect(diaDeRenovacion({ textoMd: 'sin la cláusula' }, CUOTAS)).toBe(23)
    expect(diaDeRenovacion(null, [])).toBeNull()
  })
})

describe('quién puede (D1) y la v1.5 aceptada (D2)', () => {
  const base = { producto: 'valida_cda', negocioId: 'n1', designado: true, v15: 'aceptada' as const, epaycoHabilitado: true }

  it('la persona designada con la v1.5 aceptada puede', () => {
    expect(elegibilidadTarjeta(base)).toEqual({ estado: 'puede' })
  })
  it('sin la v1.5 aceptada, el bloque lleva a aceptarla', () => {
    expect(elegibilidadTarjeta({ ...base, v15: 'pendiente' })).toEqual({ estado: 'acepta_v15' })
  })
  it('nadie más lo ve, ni sin v1.5 publicada, ni con ePayco apagado, ni fuera de un CDA', () => {
    expect(elegibilidadTarjeta({ ...base, designado: false })).toEqual({ estado: 'oculto', motivo: 'no_designado' })
    expect(elegibilidadTarjeta({ ...base, v15: 'sin_publicar' })).toEqual({ estado: 'oculto', motivo: 'sin_v15' })
    expect(elegibilidadTarjeta({ ...base, epaycoHabilitado: false })).toEqual({ estado: 'oculto', motivo: 'epayco_apagado' })
    expect(elegibilidadTarjeta({ ...base, producto: 'one' })).toEqual({ estado: 'oculto', motivo: 'no_cda' })
    expect(elegibilidadTarjeta({ ...base, negocioId: null })).toEqual({ estado: 'oculto', motivo: 'no_cda' })
  })

  const doc = (p: Partial<DocumentoContractual>): DocumentoContractual => ({
    documentoId: 'd15',
    slug: 'terminos-suscripcion-valida-cda',
    titulo: 'Términos',
    version: 'v1.5',
    textoMd: '',
    pdfSha256: 'x',
    vigenteDesde: '2026-12-01',
    vigenteHasta: null,
    aceptadoAt: null,
    aceptadoPor: null,
    aceptadoCalidad: null,
    aceptadoCanal: null,
    rigePorAviso: true,
    publicadaAt: '2026-11-01T05:00:00Z',
    ...p,
  })

  it('la v1.5 del espacio: aceptada con alguna fila con aceptación; publicada sin aceptar; o no publicada', () => {
    const v14 = doc({ documentoId: 'd14', version: 'v1.4', vigenteDesde: '2026-11-06' })
    expect(v15DelEspacio([v14]).estado).toBe('sin_publicar')
    expect(v15DelEspacio([v14, doc({})]).estado).toBe('pendiente')
    const r = v15DelEspacio([v14, doc({}), doc({ aceptadoAt: '2026-11-02T15:00:00Z' })])
    expect(r.estado).toBe('aceptada')
    expect(r.doc?.documentoId).toBe('d15')
    // Una v1.4 aceptada no cuenta como v1.5.
    expect(v15DelEspacio([doc({ documentoId: 'd14', version: 'v1.4', aceptadoAt: '2026-10-10T00:00:00Z' })]).estado).toBe('sin_publicar')
  })
})

describe('el calendario de la tarjeta de un CDA (D4): día 0 y día 3, ninguno después', () => {
  it('días 0 a 2 → intento 0; 3 a 5 → intento 1; desde el 6, nada', () => {
    expect(CALENDARIO_TARJETA_CDA.intentos).toEqual([0, 3])
    expect([0, 1, 2].map(intentoDelDiaCda)).toEqual([0, 0, 0])
    expect([3, 4, 5].map(intentoDelDiaCda)).toEqual([1, 1, 1])
    expect([6, 7, 10, -1].map(intentoDelDiaCda)).toEqual([null, null, null, null])
  })

  it('el día 0 es la fecha de renovación (inicio del período), no el vencimiento de la cuota', () => {
    expect(inicioDelPeriodo(CUOTAS[2])).toBe('2026-11-23')
    expect(inicioDelPeriodo({ concepto: 'sin período', fechaVencimiento: '2026-11-27' })).toBe('2026-11-27')
  })
})

describe('lo atrasado nunca se cobra solo (D3)', () => {
  const registro = '2026-10-30'

  it('solo entran los períodos que empiezan DESPUÉS del registro de la tarjeta', () => {
    expect(entraAlCobroAutomatico(CUOTAS[0], registro)).toBe(false)
    expect(entraAlCobroAutomatico(CUOTAS[1], registro)).toBe(false)
    expect(entraAlCobroAutomatico(CUOTAS[2], registro)).toBe(true)
    // El período que empieza el mismo día del registro tampoco: se ofrece aparte.
    expect(entraAlCobroAutomatico(CUOTAS[2], '2026-11-23')).toBe(false)
  })

  it('el 23-nov se cobra la del 23-nov (intento 0), saltando las atrasadas sin frenar', () => {
    const sel = cuotasACobrarCda({ cuotas: CUOTAS, pagadas: new Set(), cobroDesde: registro, hoy: '2026-11-23' })
    expect(sel).toEqual({ cobrar: [{ cuotaId: 'q3', numero: 3, intento: 0 }], frenado: false })
  })

  it('el 26-nov, el reintento (intento 1); el 29-nov nada y el plan queda frenado', () => {
    expect(cuotasACobrarCda({ cuotas: CUOTAS, pagadas: new Set(), cobroDesde: registro, hoy: '2026-11-26' }).cobrar).toEqual([
      { cuotaId: 'q3', numero: 3, intento: 1 },
    ])
    expect(cuotasACobrarCda({ cuotas: CUOTAS, pagadas: new Set(), cobroDesde: registro, hoy: '2026-11-29' })).toEqual({ cobrar: [], frenado: true })
  })

  it('antes de la fecha de renovación no se cobra nada, y lo atrasado tampoco', () => {
    expect(cuotasACobrarCda({ cuotas: CUOTAS, pagadas: new Set(), cobroDesde: registro, hoy: '2026-11-05' })).toEqual({ cobrar: [], frenado: false })
  })

  it('pagada la del 23-nov, el 23-dic se cobra la siguiente; una cuota en cero no se cobra', () => {
    expect(cuotasACobrarCda({ cuotas: CUOTAS, pagadas: new Set([3]), cobroDesde: registro, hoy: '2026-12-23' }).cobrar).toEqual([
      { cuotaId: 'q4', numero: 4, intento: 0 },
    ])
    const enCero = [{ ...CUOTAS[3], monto: 0 }]
    expect(cuotasACobrarCda({ cuotas: enCero, pagadas: new Set(), cobroDesde: registro, hoy: '2026-12-23' }).cobrar).toEqual([])
  })

  it('el pendiente fuera de la tarjeta: las atrasadas con saldo, con su texto y su confirmación', () => {
    const cuotas = [conEstado(CUOTAS[0], 'vencida'), conEstado(CUOTAS[1], 'vencida'), conEstado(CUOTAS[2], 'pendiente')]
    const p = pendientesFueraDeLaTarjeta(cuotas, registro)
    expect(p.map((x) => x.numero)).toEqual([1, 2])
    expect(pendienteCobrableConTarjeta(p)).toBe(true)
    expect(textoPendiente(p)).toBe('Tienes pendiente $300.000 (períodos 23-sep al 22-oct de 2026 y 23-oct al 22-nov de 2026).')
    expect(textoConfirmacionPendiente(p, '1234')).toBe(
      'Se cobrarán $300.000 a tu tarjeta terminada en 1234, en 2 cobros, uno por período. Solo esta vez: los próximos períodos se cobran en su fecha de renovación.',
    )
    expect(textoPendiente(p.slice(1))).toBe('Tienes pendiente $150.000 (período 23-oct al 22-nov de 2026).')
  })

  it('con un abono parcial no se ofrece la tarjeta (el cargo es por la cuota entera)', () => {
    const p = pendientesFueraDeLaTarjeta([conEstado(CUOTAS[1], 'abonada', 50000)], registro)
    expect(p[0].saldo).toBe(100000)
    expect(pendienteCobrableConTarjeta(p)).toBe(false)
    expect(pendienteCobrableConTarjeta([])).toBe(false)
  })
})

describe('lo que se ve con la tarjeta activa', () => {
  it('el próximo cobro es la primera cuota de la tarjeta con saldo', () => {
    const cuotas = [conEstado(CUOTAS[1], 'vencida'), conEstado(CUOTAS[2], 'pendiente')]
    const proximo = proximoCobroTarjeta({ cuotas, cobroDesde: '2026-10-30', hoy: '2026-10-30', diaRenovacion: 23 })
    expect(proximo).toEqual({ fecha: '2026-11-23', monto: 150000 })
    expect(textoTarjetaActiva('1234', proximo)).toBe('Pago automático activo · tarjeta terminada en 1234 · próximo cobro 23 de noviembre: $150.000')
  })

  it('sin la cuota creada todavía: la siguiente fecha de renovación, sin monto', () => {
    const proximo = proximoCobroTarjeta({ cuotas: [conEstado(CUOTAS[1], 'vencida')], cobroDesde: '2026-10-30', hoy: '2026-10-30', diaRenovacion: 23 })
    expect(proximo).toEqual({ fecha: '2026-11-23', monto: null })
    expect(textoTarjetaActiva(null, proximo)).toBe('Pago automático activo · tarjeta registrada · próximo cobro 23 de noviembre')
    expect(siguienteFechaDeRenovacion('2026-11-23', 23)).toBe('2026-12-23')
    expect(siguienteFechaDeRenovacion('2027-01-31', 31)).toBe('2027-02-28')
  })
})

describe('un cobro que no pasó: el reintento y la fecha de la pausa', () => {
  it('rechazado el 23-nov (período anterior a la vigencia de la v1.5): reintento 26-nov, pausa 6-dic (11.7)', () => {
    const f = fechasDelFallo({ cuota: CUOTAS[2], transicion: '2026-12-01', hoy: '2026-11-23' })
    expect(f).toEqual({ reintento: '2026-11-26', pausaDesde: '2026-12-06' })
    expect(textoFalloTarjeta({ ultimos4: '1234', fechas: f })).toBe(
      'No pudimos cobrar a tu tarjeta terminada en 1234. Puedes pagar con el enlace de pago. Reintentamos el 26 de noviembre. Si no se paga, las consultas nuevas se pausan desde el 6 de diciembre.',
    )
  })

  it('rechazado el día 3: ya no hay reintento; un período desde la vigencia se pausa a los 6 días del vencimiento', () => {
    const f = fechasDelFallo({ cuota: CUOTAS[3], transicion: '2026-12-01', hoy: '2026-12-26' })
    expect(f).toEqual({ reintento: null, pausaDesde: '2027-01-02' })
    expect(textoFalloTarjeta({ ultimos4: null, fechas: f })).toBe(
      'No pudimos cobrar a la tarjeta que registraste. Puedes pagar con el enlace de pago. Si no se paga, las consultas nuevas se pausan desde el 2 de enero.',
    )
  })
})
