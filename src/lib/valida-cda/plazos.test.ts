import { describe, expect, it } from 'vitest'
import { proximoPago, type CuotaDeServicio } from './pago-pendiente'
import {
  enPlazoParaAceptar,
  estadoMora,
  fechaDiaMes,
  mensajeConsultasRestringidas,
  mensajeSuspendidoPorMora,
  moraPermiteConsultar,
  RESTRICCION_VIGENTE_DESDE,
  sumarDias,
  textoAvisoMora,
  textoAvisoPlazo,
  textoAvisoRestriccion,
  vigenciaRestriccion,
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

describe('mora por pago antes de la v1.4: cuota que vence el 30-sep (solo la regla de los 30 días)', () => {
  it('30-sep, el día del vencimiento: nada que avisar a todos, nada que pausar', () => {
    expect(moraEl('2026-09-30')).toEqual({ estado: 'al_dia' })
  })

  it('1-oct: vencida, aviso con la fecha de corte 31-oct, pero opera', () => {
    // La pausa (31-oct) llega antes de que rija la restricción (6-nov): no hay fecha de restricción.
    expect(moraEl('2026-10-01')).toEqual({ estado: 'en_mora', vencio: '2026-09-30', restringeDesde: null, corteDesde: '2026-10-31' })
  })

  it('30-oct: todavía dentro de los 30 días, sigue el aviso', () => {
    expect(moraEl('2026-10-30')).toEqual({ estado: 'en_mora', vencio: '2026-09-30', restringeDesde: null, corteDesde: '2026-10-31' })
  })

  it('31-oct: más de 30 días de mora, Valida se pausa', () => {
    expect(moraEl('2026-10-31')).toEqual({ estado: 'suspendido', vencio: '2026-09-30', corteDesde: '2026-10-31' })
  })

  it('se mide sobre la cuota impaga MÁS VIEJA: con la 1 pagada, el 31-oct no pausa (la 2 vence el 27-oct)', () => {
    // Su D+6 (2-nov) cae antes de la vigencia: se restringe el 6-nov, no antes.
    expect(moraEl('2026-10-31', 150000)).toEqual({
      estado: 'en_mora',
      vencio: '2026-10-27',
      restringeDesde: '2026-11-06',
      corteDesde: '2026-11-27',
    })
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
      'Hay un pago de la suscripción vencido desde el 30-sep. Si no se registra, Valida se pausa desde el 31-oct (cláusula 11 de los términos).',
    )
    const s = moraEl('2026-10-31')
    if (s.estado !== 'suspendido') throw new Error('se esperaba suspensión')
    expect(mensajeSuspendidoPorMora(s)).toContain('pausada desde el 31-oct')
    expect(mensajeSuspendidoPorMora(s)).not.toMatch(/\$|150/)
  })
})

/**
 * Cláusula 11 v1.4 (aviso publicado en la plataforma el 2026-10-07, rige el 6-nov). Con vencimiento D: aviso desde D+1 con la
 * fecha de la restricción, restringido desde D+6, pausa desde D+31.
 */
describe('restricción por mora a los 5 días (cláusula 11.1 v1.4, rige el 6-nov-2026)', () => {
  const pendiente = (fechaVencimiento: string) =>
    proximoPago({ cuotas: [cuota(1, fechaVencimiento)], cobros: [], hoy: fechaVencimiento, ahoraISO: `${fechaVencimiento}T15:00:00Z` })
  const mora = (venc: string, hoy: string) => estadoMora(pendiente(venc), hoy)

  it('la vigencia esperada es el 6-nov-2026: publicación del 7-oct + 30 días calendario', () => {
    expect(RESTRICCION_VIGENTE_DESDE).toBe('2026-11-06')
    expect(sumarDias('2026-10-07', 30)).toBe(RESTRICCION_VIGENTE_DESDE)
  })

  describe('cuota que vence el 10-nov (después de la vigencia)', () => {
    const v = '2026-11-10'
    it('D (10-nov): nada', () => expect(mora(v, '2026-11-10')).toEqual({ estado: 'al_dia' }))
    it('D+1 (11-nov): aviso con la fecha de la restricción, 16-nov', () =>
      expect(mora(v, '2026-11-11')).toEqual({ estado: 'en_mora', vencio: v, restringeDesde: '2026-11-16', corteDesde: '2026-12-11' }))
    it('D+5 (15-nov): todavía aviso, se consulta', () => {
      const m = mora(v, '2026-11-15')
      expect(m.estado).toBe('en_mora')
      expect(moraPermiteConsultar(m)).toBe(true)
    })
    it('D+6 (16-nov): restringido, sin consultas nuevas', () => {
      const m = mora(v, '2026-11-16')
      expect(m).toEqual({ estado: 'restringido', vencio: v, restringeDesde: '2026-11-16', corteDesde: '2026-12-11' })
      expect(moraPermiteConsultar(m)).toBe(false)
    })
    it('D+30 (10-dic): sigue restringido, no pausado', () =>
      expect(mora(v, '2026-12-10').estado).toBe('restringido'))
    it('D+31 (11-dic): más de 30 días, pausado', () =>
      expect(mora(v, '2026-12-11')).toEqual({ estado: 'suspendido', vencio: v, corteDesde: '2026-12-11' }))
  })

  describe('cuota vencida ANTES de la vigencia (15-oct): la regla alcanza lo ya vencido desde el 6-nov', () => {
    const v = '2026-10-15'
    it('D+6 (21-oct) no restringe: antes del 6-nov solo existe la regla de los 30 días', () =>
      expect(mora(v, '2026-10-21')).toEqual({ estado: 'en_mora', vencio: v, restringeDesde: '2026-11-06', corteDesde: '2026-11-15' }))
    it('5-nov: todavía aviso (era el día de la vigencia antes de publicarse el 7-oct)', () =>
      expect(mora(v, '2026-11-05').estado).toBe('en_mora'))
    it('6-nov: restringido desde la vigencia', () =>
      expect(mora(v, '2026-11-06')).toEqual({ estado: 'restringido', vencio: v, restringeDesde: '2026-11-06', corteDesde: '2026-11-15' }))
    it('15-nov (D+31): pausado', () => expect(mora(v, '2026-11-15').estado).toBe('suspendido'))
  })

  it('con otra fecha de vigencia (si el aviso sale otro día), la restricción se corre con ella', () => {
    expect(estadoMora(pendiente('2026-11-10'), '2026-11-16', '2026-11-20').estado).toBe('en_mora')
    expect(estadoMora(pendiente('2026-11-10'), '2026-11-20', '2026-11-20').estado).toBe('restringido')
  })

  it('el pago registrado levanta la restricción: con la cuota cubierta, al día', () => {
    const pagado = proximoPago({
      cuotas: [cuota(1, '2026-11-10')],
      cobros: [{ monto: 150000, estado: 'pagado' }],
      hoy: '2026-11-20',
      ahoraISO: '2026-11-20T15:00:00Z',
    })
    expect(estadoMora(pagado, '2026-11-20')).toEqual({ estado: 'al_dia' })
    // Un cobro programado (el enlace emitido, aún sin aprobar) no es plata: sigue restringido.
    const programado = proximoPago({
      cuotas: [cuota(1, '2026-11-10')],
      cobros: [{ monto: 150000, estado: 'programado' }],
      hoy: '2026-11-20',
      ahoraISO: '2026-11-20T15:00:00Z',
    })
    expect(estadoMora(programado, '2026-11-20').estado).toBe('restringido')
  })

  it('los períodos ya pagados (p. ej. un plan anual pagado de una vez) no restringen ni pausan (anexo, 6.1)', () => {
    // Una sola cuota de 12 períodos, pagada al aprobarse el pago: no queda cuota impaga que medir.
    const anual: CuotaDeServicio = { ...cuota(2, '2026-11-20'), tipo: 'anual', monto: 1650000 }
    for (const hoy of ['2026-12-31', '2027-06-30', '2027-11-22']) {
      const pago = proximoPago({
        cuotas: [cuota(1, '2026-09-30'), anual],
        cobros: [
          { monto: 150000, estado: 'pagado' },
          { monto: 1650000, estado: 'pagado' },
        ],
        hoy,
        ahoraISO: `${hoy}T15:00:00Z`,
      })
      expect(estadoMora(pago, hoy)).toEqual({ estado: 'al_dia' })
    }
  })

  it('los textos dicen las fechas, que el histórico sigue abierto y no nombran montos', () => {
    const aviso = mora('2026-11-10', '2026-11-11')
    if (aviso.estado !== 'en_mora') throw new Error('se esperaba aviso')
    expect(textoAvisoMora(aviso)).toBe(
      'Hay un pago de la suscripción vencido desde el 10-nov. Si no se registra, desde el 16-nov no se podrán hacer ' +
        'consultas nuevas; los reportes ya generados seguirán disponibles (cláusula 11 de los términos).',
    )
    const r = mora('2026-11-10', '2026-11-16')
    if (r.estado !== 'restringido') throw new Error('se esperaba restricción')
    expect(mensajeConsultasRestringidas(r)).toBe(
      'Las consultas nuevas están restringidas desde el 16-nov por un pago de la suscripción vencido desde el 10-nov. ' +
        'Los reportes ya generados siguen disponibles. Las consultas se habilitan de nuevo cuando se registre el pago.',
    )
    expect(textoAvisoRestriccion(r)).toContain('Valida se pausa desde el 11-dic')
    for (const t of [textoAvisoMora(aviso), textoAvisoRestriccion(r)]) expect(t).not.toMatch(/\$|150/)
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

describe('la vigencia de la restricción sale del dato registrado, no de una constante', () => {
  const doc = (version: string, vigenteDesde: string, slug = 'terminos-suscripcion-valida-cda') => ({ slug, version, vigenteDesde })

  it('es el vigente_desde de la v1.4 del contrato (la haya aceptado o no)', () => {
    expect(vigenciaRestriccion([doc('v1.2', '2026-09-23'), doc('v1.3', '2026-09-24'), doc('v1.4', '2026-11-06')])).toBe('2026-11-06')
  })

  it('si el aviso se hubiera publicado otro día, la fecha es la registrada', () => {
    expect(vigenciaRestriccion([doc('v1.3', '2026-09-24'), doc('v1.4', '2026-11-09')])).toBe('2026-11-09')
  })

  it('una versión posterior que ya la trae cuenta; gana la más temprana', () => {
    expect(vigenciaRestriccion([doc('v1.5', '2027-01-10'), doc('v1.4', '2026-11-06')])).toBe('2026-11-06')
    expect(vigenciaRestriccion([doc('v2.0', '2027-01-10')])).toBe('2027-01-10')
    expect(vigenciaRestriccion([doc('v1.10', '2027-02-01')])).toBe('2027-02-01')
  })

  it('sin v1.4 registrada no hay restricción: sin aviso no hay cambio', () => {
    expect(vigenciaRestriccion([doc('v1.3', '2026-09-24')])).toBeNull()
    expect(vigenciaRestriccion([doc('v1.4', '2026-11-06', 'terminos-uso-valida')])).toBeNull()
    expect(vigenciaRestriccion([])).toBeNull()
  })

  it('con vigencia null, la mora solo pausa a los 30 días: nunca restringe', () => {
    const pago = proximoPago({ cuotas: [cuota(1, '2026-11-10')], cobros: [], hoy: '2026-11-10', ahoraISO: '2026-11-10T15:00:00Z' })
    expect(estadoMora(pago, '2026-11-11', null)).toEqual({ estado: 'en_mora', vencio: '2026-11-10', restringeDesde: null, corteDesde: '2026-12-11' })
    expect(estadoMora(pago, '2026-11-20', null).estado).toBe('en_mora')
    expect(estadoMora(pago, '2026-12-11', null).estado).toBe('suspendido')
  })
})
