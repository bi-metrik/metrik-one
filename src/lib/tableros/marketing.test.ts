import { describe, expect, it } from 'vitest'
import {
  cac,
  cohorteInmadura,
  conversion,
  cpl,
  lenteCohorte,
  lenteMes,
  mesesConDatos,
  roas,
  totales,
  type FilaMarketing,
} from './marketing'

/**
 * Filas REALES de produccion, medidas el 2026-09-03 contra
 * `v_marketing_campana` en el workspace de SOENA. Se copian con su fecha para que el
 * dia que la cifra cambie se vea que la prueba envejecio, en vez de parecer un
 * defecto: la base es una sola y se mueve debajo del codigo.
 *
 * El gasto son los tramos que la Graph API devolvio ese mismo dia.
 */
const f = (p: Partial<FilaMarketing> & Pick<FilaMarketing, 'campaignId' | 'mes'>): FilaMarketing => ({
  campana: null,
  gasto: 0,
  leads: 0,
  formularios: 0,
  negocios: 0,
  ventas: 0,
  honorario: 0,
  recaudado: 0,
  primerLead: null,
  ultimoLead: null,
  status: null,
  sincronizadoAt: null,
  ...p,
})

const VIDEO = '120248098468670215'
const PLUS = '52656511383228'
const SEP50 = '52663199200828'

const SOENA: FilaMarketing[] = [
  // CAMPAÑA JUNIO 2026 DJ - VIDEO: 135 leads en julio, 7 ventas repartidas en jul/ago.
  f({ campaignId: VIDEO, campana: 'CAMPAÑA JUNIO 2026 DJ - VIDEO', mes: '2026-06-01',
      gasto: 306691, sincronizadoAt: '2026-09-03T18:00:00Z' }),
  f({ campaignId: VIDEO, campana: 'CAMPAÑA JUNIO 2026 DJ - VIDEO', mes: '2026-07-01',
      gasto: 907714, sincronizadoAt: '2026-09-03T18:00:00Z',
      leads: 135, formularios: 135, negocios: 37, ventas: 5, honorario: 2592857, recaudado: 2592857,
      primerLead: '2026-07-08T00:00:00Z', ultimoLead: '2026-07-31T03:12:53Z' }),
  f({ campaignId: VIDEO, campana: 'CAMPAÑA JUNIO 2026 DJ - VIDEO', mes: '2026-08-01',
      ventas: 2, honorario: 1035714, recaudado: 1035714 }),
  // La campana que Meta RENOMBRO: el payload dice PLUS, Meta hoy dice ($100).
  f({ campaignId: PLUS, campana: 'CLIENTES POTENCIALES AGO ($100)', mes: '2026-08-01',
      gasto: 1524621, sincronizadoAt: '2026-09-03T18:00:00Z',
      leads: 304, formularios: 305, negocios: 17, ventas: 6, honorario: 3002750, recaudado: 3002750,
      primerLead: '2026-08-06T00:00:00Z', ultimoLead: '2026-08-24T16:09:30Z' }),
  // Cohorte recien nacida: 5 leads, 0 ventas. Su 0% no significa nada todavia.
  f({ campaignId: SEP50, campana: 'CLIENTES POTENCIALES SEP ($50)', mes: '2026-09-01',
      gasto: 50194, sincronizadoAt: '2026-09-03T18:00:00Z',
      leads: 5, formularios: 5, negocios: 1,
      primerLead: '2026-09-03T00:00:00Z', ultimoLead: '2026-09-03T13:05:05Z' }),
  // Sin rastro de Meta: las ventas que no dejaron huella.
  f({ campaignId: null, mes: '2026-08-01', ventas: 47, honorario: 21000000, recaudado: 21328168 }),
  f({ campaignId: null, mes: '2026-07-01', ventas: 39, honorario: 19000000, recaudado: 19768277 }),
]

describe('lenteMes', () => {
  it('agosto: solo lo de agosto, y la fila sin rastro va al final', () => {
    const filas = lenteMes(SOENA, '2026-08-01')
    expect(filas.map(x => x.campaignId)).toEqual([PLUS, VIDEO, null])
    // La campana de video vendio en agosto con leads de julio: en la lente MES eso
    // son 2 ventas y CERO leads. Es correcto y es justo lo que la lente MES mide.
    const video = filas.find(x => x.campaignId === VIDEO)!
    expect(video.ventas).toBe(2)
    expect(video.leads).toBe(0)
  })

  it('la fila sin rastro NO se pierde ni se mezcla con las campanas', () => {
    const sinRastro = lenteMes(SOENA, '2026-08-01').find(x => x.sinRastro)!
    expect(sinRastro.ventas).toBe(47)
    expect(sinRastro.campana).toBe('Sin rastro de Meta')
  })

  it('un mes sin ninguna campana devuelve lista vacia, no una tabla de ceros', () => {
    expect(lenteMes(SOENA, '2026-06-01').filter(x => !x.sinRastro)).toHaveLength(1)
    expect(lenteMes(SOENA, '2026-01-01')).toEqual([])
  })
})

describe('lenteCohorte', () => {
  it('suma los meses de cada campana: la de video da 135 leads y 7 ventas', () => {
    const video = lenteCohorte(SOENA).find(x => x.campaignId === VIDEO)!
    expect(video.leads).toBe(135)
    expect(video.ventas).toBe(7)
    // El gasto tambien es la suma de los meses: 306.691 + 907.714.
    expect(video.gasto).toBe(1214405)
    expect(conversion(video)).toBeCloseTo(0.0519, 4)
  })

  it('la campana renombrada aparece UNA sola vez, con la etiqueta de Meta', () => {
    // Si saliera partida en dos filas, la vista estaria agrupando por nombre.
    const plus = lenteCohorte(SOENA).filter(x => x.campaignId === PLUS)
    expect(plus).toHaveLength(1)
    expect(plus[0].campana).toBe('CLIENTES POTENCIALES AGO ($100)')
    expect(plus[0].leads).toBe(304)
    expect(plus[0].ventas).toBe(6)
  })

  it('ordena por fecha de inicio descendente, nunca por conversion', () => {
    // Por conversion, la de video (5,2%) iria primera y la recien lanzada ultima.
    // Se ordena al reves a proposito: arriba lo mas nuevo, no lo mejor medido.
    expect(lenteCohorte(SOENA).map(x => x.campaignId)).toEqual([SEP50, PLUS, VIDEO, null])
  })
})

describe('derivados', () => {
  const cohorte = lenteCohorte(SOENA)
  const video = cohorte.find(x => x.campaignId === VIDEO)!
  const sep = cohorte.find(x => x.campaignId === SEP50)!

  it('CPL, CAC y ROAS sobre la campana de video', () => {
    expect(cpl(video)).toBeCloseTo(8995.6, 1)
    expect(cac(video)).toBeCloseTo(173486.4, 1)
    expect(roas(video)).toBeCloseTo(2.99, 2)
  })

  it('sin ventas no hay CAC, y eso NO es cero', () => {
    // Dividir por cero y pintar 0 diria que adquirir un cliente salio gratis.
    expect(sep.ventas).toBe(0)
    expect(cac(sep)).toBeNull()
    expect(roas(sep)).toBeCloseTo(0, 5)
  })

  it('sin gasto sincronizado no hay CPL ni CAC ni ROAS', () => {
    // Es el estado del dia 1: la tabla existe y esta vacia. La pantalla tiene que
    // pintar una raya y decir que el gasto no se ha sincronizado, nunca un cero.
    const sinSync = lenteCohorte(SOENA.map(x => ({ ...x, gasto: 0, sincronizadoAt: null })))
    const v = sinSync.find(x => x.campaignId === VIDEO)!
    expect(v.gastoConocido).toBe(false)
    expect(cpl(v)).toBeNull()
    expect(cac(v)).toBeNull()
    expect(roas(v)).toBeNull()
    // Lo que SI se puede afirmar sigue en pie.
    expect(v.leads).toBe(135)
    expect(v.ventas).toBe(7)
    expect(conversion(v)).toBeCloseTo(0.0519, 4)
  })
})

describe('cohorteInmadura', () => {
  const HOY = '2026-09-03T18:00:00Z'

  it('una campana cuyo ultimo lead entro hoy no se puede juzgar', () => {
    expect(cohorteInmadura('2026-09-03T13:05:05Z', HOY)).toBe(true)
  })

  it('una campana con leads de hace mas de 30 dias si', () => {
    expect(cohorteInmadura('2026-07-31T03:12:53Z', HOY)).toBe(false)
  })

  it('el limite es 30 dias, no "el mes pasado"', () => {
    expect(cohorteInmadura('2026-08-05T18:00:00Z', HOY)).toBe(true)  // 29 dias
    expect(cohorteInmadura('2026-08-03T17:00:00Z', HOY)).toBe(false) // 31 dias
  })

  it('sin leads no se declara inmadura: no hay nada que esperar', () => {
    expect(cohorteInmadura(null, HOY)).toBe(false)
  })
})

describe('totales', () => {
  it('agosto: las campanas y el sin rastro se suman aparte', () => {
    const t = totales(lenteMes(SOENA, '2026-08-01'))
    expect(t.ventas).toBe(8)
    expect(t.ventasSinRastro).toBe(47)
    expect(t.recaudado).toBe(1035714 + 3002750)
    expect(t.recaudadoSinRastro).toBe(21328168)
    // Que parte de la venta del mes trae marketing.
    expect(t.parteDeLasVentas).toBeCloseTo(0.159, 3)
  })

  it('el gasto y los leads del total NO incluyen la fila sin rastro', () => {
    const t = totales(lenteMes(SOENA, '2026-08-01'))
    expect(t.gasto).toBe(1524621)
    expect(t.leads).toBe(304)
  })
})

describe('mesesConDatos', () => {
  it('del mas reciente al mas viejo, sin repetir', () => {
    expect(mesesConDatos(SOENA)).toEqual(['2026-09-01', '2026-08-01', '2026-07-01', '2026-06-01'])
  })
})
