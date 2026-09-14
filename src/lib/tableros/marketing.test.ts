import { describe, expect, it } from 'vitest'
import {
  cac,
  cohorteInmadura,
  conversion,
  cpl,
  drillSeAcotaAVentas,
  lenteCohorte,
  lenteMes,
  mesesConDatos,
  roas,
  totales,
  totalesPorCiudad,
  ventasPorCiudad,
  type FilaMarketing,
  type FilaNegocioMarketing,
} from './marketing'
import { COLUMNAS_DIRECTIVO } from '@/lib/dian/agrupacion-directivo'

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

  it('el nombre de Meta gana aunque solo UNO de sus meses este sincronizado', () => {
    // Salio del QA contra produccion, no de una revision: la campana renombrada tiene
    // una venta en julio (mes sin sincronizar, con el nombre viejo del payload) y sus
    // leads en agosto (mes sincronizado, con el nombre de hoy). Acumulando "el ultimo
    // nombre que se cruce" la cohorte quedaba etiquetada con la foto vieja.
    const filas: FilaMarketing[] = [
      f({ campaignId: PLUS, campana: 'CLIENTES POTENCIALES AGO ($100)', mes: '2026-08-01',
          gasto: 1524621, sincronizadoAt: '2026-09-03T20:00:00Z', leads: 304, ventas: 5 }),
      f({ campaignId: PLUS, campana: 'CLIENTES POTENCIALES AGO 2026 PLUS', mes: '2026-07-01',
          ventas: 1 }),
    ]
    expect(lenteCohorte(filas)[0].campana).toBe('CLIENTES POTENCIALES AGO ($100)')
    // Y en la lente MES cada mes se llama como se llamaba, que es lo correcto: ahi la
    // pregunta es por ESE mes.
    expect(lenteMes(filas, '2026-07-01')[0].campana).toBe('CLIENTES POTENCIALES AGO 2026 PLUS')
  })

  it('sin ninguna fila sincronizada, la etiqueta es la del payload mas reciente', () => {
    const filas: FilaMarketing[] = [
      f({ campaignId: PLUS, campana: 'NOMBRE VIEJO', mes: '2026-07-01' }),
      f({ campaignId: PLUS, campana: 'NOMBRE NUEVO', mes: '2026-08-01' }),
    ]
    expect(lenteCohorte(filas)[0].campana).toBe('NOMBRE NUEVO')
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

// ─────────────────────────────────────────────────────────────────────────────
// Ventas por ciudad
//
// ⚠️ Mutaciones MEDIDAS el 2026-09-14 sobre `ventasPorCiudad` / `totalesPorCiudad`, con
// la linea base comprobada verde antes de cada una y restaurada despues:
//   · la agrupacion se ignora (todo cae en "Otras ciudades") ............... 4 rojas
//   · la lente de mes no filtra ............................................ 4 rojas
//   · un lead sin venta cuenta como venta .................................. 3 rojas
//   · "Sin rastro" se suma a las campanas .................................. 1 roja
//   · la venta huerfana se descarta en silencio ............................ 1 roja
//   · las filas salen en otro orden que la tabla de arriba ................. 3 rojas
//   · las columnas en cero desaparecen ..................................... 4 rojas
//
// La ultima NO caia con la primera version del fixture: todas las campanas de la lente
// de septiembre tenian ventas, asi que el camino del `??  columnasEnCero()` no se
// ejecutaba nunca. Se repuso con las filas REALES de `v_marketing_campana`, que incluyen
// dos campanas con leads y cero ventas (WEBINAR y SEP ($50)). Es el mismo defecto de
// fixture del #581: los datos sembrados no podian separar los dos criterios.
//
// Filas REALES de produccion, medidas el 2026-09-14 contra `v_marketing_negocio` y
// `negocios.metadata->>'seccional'` en el workspace de SOENA
// (7dea141d-d4da-483d-a78d-b14ef35500c5). Se copian con su fecha: la base es una sola y
// se mueve debajo del codigo, asi que el dia que la cifra cambie tiene que verse que la
// prueba envejecio en vez de parecer un defecto.
//
// Son las 28 ventas con campana de ese dia. Las 28 tienen seccional — que es justo el
// hallazgo que decide el diseno: la ciudad llega con el RUT en Documentacion, asi que la
// tienen las ventas y no los leads (de 99 negocios con campana, 28 con seccional, los
// mismos 28 que son ventas).
//
// ⚠️ Este juego NO trae la fila "Sin rastro de Meta": a esa fecha eran 302 ventas y
// copiarlas una por una no agrega nada. Su comportamiento se prueba aparte, con un juego
// chico donde las dos caras (campana y negocio) se pueden leer de un vistazo.

const VIDEO_ID = '120248098468670215'
const SEP_DANIELA = '120250901461170215'
const JUL_AGO = '52653642310428'
const AGO_2026 = '52655556820428'
const PLUS_ID = '52656511383228'
const AGO_50 = '52661829912228'
const SEP_50 = '52663199200828'
const SEP_70 = '52663609288628'
const WEBINAR = '52664310612028'

const n = (
  campaignId: string | null,
  mesVenta: string | null,
  seccional: string | null,
): FilaNegocioMarketing => ({ campaignId, mesVenta, seccional, honorario: 0, recaudado: 0 })

/** Las 28 ventas con campana de SOENA, 2026-09-14. */
const VENTAS_SOENA: FilaNegocioMarketing[] = [
  n(VIDEO_ID, '2026-07-01', 'Barranquilla'),
  n(VIDEO_ID, '2026-07-01', 'Bogotá'),
  n(VIDEO_ID, '2026-07-01', 'Cúcuta'),
  n(VIDEO_ID, '2026-07-01', 'Montería'),
  n(VIDEO_ID, '2026-07-01', 'Palmira'),
  n(VIDEO_ID, '2026-08-01', 'Girardot'),
  n(VIDEO_ID, '2026-08-01', 'Manizales'),
  n(VIDEO_ID, '2026-09-01', 'Montería'),
  n(SEP_DANIELA, '2026-08-01', 'Armenia'),
  n(SEP_DANIELA, '2026-08-01', 'Pereira'),
  n(SEP_DANIELA, '2026-09-01', 'Bucaramanga'),
  n(JUL_AGO, '2026-08-01', 'Bucaramanga'),
  n(JUL_AGO, '2026-08-01', 'Bucaramanga'),
  n(JUL_AGO, '2026-08-01', 'Cartagena'),
  n(JUL_AGO, '2026-08-01', 'Medellín'),
  n(AGO_2026, '2026-08-01', 'Medellín'),
  n(PLUS_ID, '2026-07-01', 'Medellín'),
  n(PLUS_ID, '2026-08-01', 'Cali'),
  n(PLUS_ID, '2026-08-01', 'Medellín'),
  n(PLUS_ID, '2026-08-01', 'Medellín'),
  n(PLUS_ID, '2026-08-01', 'Santa Marta'),
  n(PLUS_ID, '2026-08-01', 'Villavicencio'),
  n(PLUS_ID, '2026-09-01', 'Medellín'),
  n(AGO_50, '2026-08-01', 'Bogotá'),
  n(AGO_50, '2026-08-01', 'Medellín'),
  n(AGO_50, '2026-09-01', 'Cali'),
  n(AGO_50, '2026-09-01', 'Florencia'),
  n(SEP_70, '2026-09-01', 'Popayán'),
  // Dos leads de la misma fecha que todavia no son venta: la tabla de ciudades no los
  // cuenta, y por eso mismo estan aqui. Sin ellos, quitar el filtro de venta no rompe
  // ninguna prueba.
  n(PLUS_ID, null, null),
  n(VIDEO_ID, null, null),
]

/**
 * La MISMA realidad vista desde `v_marketing_campana`: una fila por (campana, mes) con
 * el conteo de ventas que el SQL saca de `v_marketing_negocio`. Escrita literal, no
 * derivada del arreglo de arriba: si una de las dos caras se recalculara desde la otra,
 * la prueba de que las dos tablas cuentan la MISMA venta no probaria nada.
 */
const CAMPANAS_SOENA: FilaMarketing[] = [
  f({ campaignId: VIDEO_ID, campana: 'CAMPAÑA JUNIO 2026 DJ - VIDEO', mes: '2026-07-01',
      leads: 135, ventas: 5, primerLead: '2026-07-08T12:36:22+00:00' }),
  f({ campaignId: VIDEO_ID, campana: 'CAMPAÑA JUNIO 2026 DJ - VIDEO', mes: '2026-08-01', ventas: 2 }),
  f({ campaignId: VIDEO_ID, campana: 'CAMPAÑA JUNIO 2026 DJ - VIDEO', mes: '2026-09-01', ventas: 1 }),
  f({ campaignId: SEP_DANIELA, campana: 'CAMPAÑA SEP DANIELA', mes: '2026-08-01',
      leads: 34, ventas: 2, primerLead: '2026-08-27T19:24:08+00:00' }),
  f({ campaignId: SEP_DANIELA, campana: 'CAMPAÑA SEP DANIELA', mes: '2026-09-01',
      leads: 113, ventas: 1, primerLead: '2026-09-01T06:49:26+00:00' }),
  // Un mes con leads y CERO ventas: existe en la tabla de campanas y su fila de ciudades
  // tiene que dibujarse en ceros, no desaparecer.
  f({ campaignId: JUL_AGO, campana: 'CLIENTES POTENCIALES JUL/AGO 2026', mes: '2026-07-01',
      leads: 49, ventas: 0, primerLead: '2026-07-29T19:41:57+00:00' }),
  f({ campaignId: JUL_AGO, campana: 'CLIENTES POTENCIALES JUL/AGO 2026', mes: '2026-08-01',
      leads: 53, ventas: 4, primerLead: '2026-08-01T07:57:22+00:00' }),
  f({ campaignId: AGO_2026, campana: 'CLIENTES POTENCIALES AGO 2026', mes: '2026-08-01',
      leads: 16, ventas: 1, primerLead: '2026-08-04T21:34:46+00:00' }),
  f({ campaignId: PLUS_ID, campana: 'CLIENTES POTENCIALES AGO 2026 PLUS', mes: '2026-07-01', ventas: 1 }),
  f({ campaignId: PLUS_ID, campana: 'CLIENTES POTENCIALES AGO 2026 PLUS', mes: '2026-08-01',
      leads: 304, ventas: 5, primerLead: '2026-08-06T21:54:16+00:00' }),
  f({ campaignId: PLUS_ID, campana: 'CLIENTES POTENCIALES AGO 2026 PLUS', mes: '2026-09-01', ventas: 1 }),
  f({ campaignId: AGO_50, campana: 'CLIENTES POTENCIALES AGO ($50)', mes: '2026-08-01',
      leads: 93, ventas: 2, primerLead: '2026-08-24T20:55:56+00:00' }),
  f({ campaignId: AGO_50, campana: 'CLIENTES POTENCIALES AGO ($50)', mes: '2026-09-01',
      leads: 1, ventas: 2, primerLead: '2026-09-01T14:12:18+00:00' }),
  f({ campaignId: SEP_50, campana: 'CLIENTES POTENCIALES SEP ($50)', mes: '2026-09-01',
      leads: 5, ventas: 0, primerLead: '2026-09-03T01:52:59+00:00' }),
  f({ campaignId: SEP_70, campana: 'CLIENTES POTENCIALES SEP ($70)', mes: '2026-09-01',
      leads: 69, ventas: 1, primerLead: '2026-09-03T21:42:50+00:00' }),
  f({ campaignId: WEBINAR, campana: 'WEBINAR', mes: '2026-09-01',
      leads: 23, ventas: 0, primerLead: '2026-09-07T23:41:32+00:00' }),
]

describe('ventasPorCiudad', () => {
  it('cohorte: las cuatro ciudades nombradas dan lo medido en produccion', () => {
    const filas = ventasPorCiudad(lenteCohorte(CAMPANAS_SOENA), VENTAS_SOENA, null)
    const t = totalesPorCiudad(filas)
    expect(t.columnas['Medellín']).toBe(7)
    expect(t.columnas['Bucaramanga']).toBe(3)
    expect(t.columnas['Cali']).toBe(2)
    expect(t.columnas['Bogotá']).toBe(2)
    // Las 14 restantes son ciudades de a una o dos. Sin agrupar, la tabla tendria 17
    // columnas para 28 ventas y seria ilegible.
    expect(t.columnas['Otras ciudades']).toBe(14)
    // Cero, y aun asi la columna existe: las 28 ventas tienen seccional porque la
    // seccional ENTRA con el RUT, y sin RUT no hay venta. Si alguna cayera aqui seria
    // porque su texto no canonizo, y eso hay que poder verlo.
    expect(t.columnas['Sin seccional']).toBe(0)
    expect(t.total).toBe(28)
  })

  it('el total cuadra con el de la tabla de campanas, en los dos lentes', () => {
    // Es la invariante que sostiene la pantalla: si las dos tablas contaran ventas
    // distintas, habria dos definiciones de venta conviviendo — el defecto que ya costo
    // `v_venta_mes_comercial`.
    for (const mes of [null, '2026-07-01', '2026-08-01', '2026-09-01']) {
      const campanas = mes === null ? lenteCohorte(CAMPANAS_SOENA) : lenteMes(CAMPANAS_SOENA, mes)
      const esperado = totales(campanas).ventas
      const obtenido = totalesPorCiudad(ventasPorCiudad(campanas, VENTAS_SOENA, mes)).campanas
      expect({ mes, ventas: obtenido }).toEqual({ mes, ventas: esperado })
    }
  })

  it('y cuadra fila por fila, no solo en el total', () => {
    // Un total puede cuadrar con dos filas equivocadas que se compensan. La igualdad
    // real es campana a campana.
    const campanas = lenteMes(CAMPANAS_SOENA, '2026-08-01')
    const filas = ventasPorCiudad(campanas, VENTAS_SOENA, '2026-08-01')
    expect(filas.map(x => [x.campaignId, x.total])).toEqual(campanas.map(c => [c.campaignId, c.ventas]))
  })

  it('agosto: 16 ventas con 5 en Medellin, y septiembre NO se cuela', () => {
    const filas = ventasPorCiudad(lenteMes(CAMPANAS_SOENA, '2026-08-01'), VENTAS_SOENA, '2026-08-01')
    const t = totalesPorCiudad(filas)
    expect(t.total).toBe(16)
    expect(t.columnas['Medellín']).toBe(5)
    expect(t.columnas['Bucaramanga']).toBe(2)
    // En cohorte hay 3 en Bucaramanga y 7 en Medellin: la lente tiene que morder.
    expect(t.columnas['Bogotá']).toBe(1)
  })

  it('las filas salen en el MISMO orden que la tabla de campanas', () => {
    const campanas = lenteCohorte(CAMPANAS_SOENA)
    const filas = ventasPorCiudad(campanas, VENTAS_SOENA, null)
    expect(filas.map(x => x.campaignId)).toEqual(campanas.map(c => c.campaignId))
    expect(filas.map(x => x.campana)).toEqual(campanas.map(c => c.campana))
  })

  it('una campana sin ventas en el mes se dibuja en ceros, no desaparece', () => {
    // WEBINAR y SEP_50 tuvieron leads en septiembre y ninguna venta: estan en la tabla
    // de campanas y tienen que estar aqui, con sus seis columnas en cero. Una fila que
    // se esconde porque no vendio deja la tabla diciendo que esa campana no existe.
    const campanas = lenteMes(CAMPANAS_SOENA, '2026-09-01')
    const filas = ventasPorCiudad(campanas, VENTAS_SOENA, '2026-09-01')
    for (const fila of filas) {
      expect(Object.keys(fila.columnas).sort()).toEqual([...COLUMNAS_DIRECTIVO].sort())
    }
    for (const id of [WEBINAR, SEP_50]) {
      const vacia = filas.find(x => x.campaignId === id)!
      expect(vacia.total).toBe(0)
      expect(vacia.columnas['Medellín']).toBe(0)
    }
    // JUL_AGO vendio 4 en agosto y no tiene fila en septiembre: tampoco aparece aqui.
    expect(filas.find(x => x.campaignId === JUL_AGO)).toBeUndefined()
  })

  it('un lead sin venta no cuenta como venta', () => {
    // Los dos negocios con `mesVenta: null` del fixture. Si el filtro de venta se
    // cayera, la cohorte diria 30 en vez de 28 y la columna "Sin seccional" diria 2.
    const t = totalesPorCiudad(ventasPorCiudad(lenteCohorte(CAMPANAS_SOENA), VENTAS_SOENA, null))
    expect(t.total).toBe(28)
    expect(t.columnas['Sin seccional']).toBe(0)
  })
})

describe('ventasPorCiudad · sin rastro de Meta', () => {
  // Juego chico y consistente entre las dos caras: dos campanas y la fila sin rastro.
  const CAMP: FilaMarketing[] = [
    f({ campaignId: 'A', campana: 'Campaña A', mes: '2026-08-01', ventas: 2,
        primerLead: '2026-08-01T00:00:00Z' }),
    f({ campaignId: null, mes: '2026-08-01', ventas: 3 }),
  ]
  const NEG: FilaNegocioMarketing[] = [
    n('A', '2026-08-01', 'Medellín'),
    n('A', '2026-08-01', 'Cali'),
    n(null, '2026-08-01', 'Bogotá'),
    n(null, '2026-08-01', null),
    n(null, '2026-08-01', '   '),
  ]

  it('la fila sin rastro va al final y NO se suma a las campanas', () => {
    const filas = ventasPorCiudad(lenteMes(CAMP, '2026-08-01'), NEG, '2026-08-01')
    expect(filas.map(x => x.sinRastro)).toEqual([false, true])
    const t = totalesPorCiudad(filas)
    expect(t.campanas).toBe(2)
    expect(t.sinRastro).toBe(3)
    // El total de la fila de totales dice de que esta hecho: campanas + sin rastro.
    expect(t.total).toBe(5)
    expect(t.campanas).toBe(totales(lenteMes(CAMP, '2026-08-01')).ventas)
    expect(t.sinRastro).toBe(totales(lenteMes(CAMP, '2026-08-01')).ventasSinRastro)
  })

  it('una seccional vacia o en blanco cae en "Sin seccional", no en "Otras ciudades"', () => {
    const filas = ventasPorCiudad(lenteMes(CAMP, '2026-08-01'), NEG, '2026-08-01')
    const sin = filas.find(x => x.sinRastro)!
    expect(sin.columnas['Sin seccional']).toBe(2)
    expect(sin.columnas['Bogotá']).toBe(1)
    expect(sin.columnas['Otras ciudades']).toBe(0)
  })

  it('la columna "Sin seccional" del total NO es siempre cero', () => {
    // Medido en produccion el 2026-09-14: de las 302 ventas sin rastro de Meta, 7 no
    // tienen seccional. La columna existe porque hay casos reales que caen ahi, no como
    // adorno. El QA del brief decia "sale en cero": eso vale para las filas de campana.
    const t = totalesPorCiudad(ventasPorCiudad(lenteMes(CAMP, '2026-08-01'), NEG, '2026-08-01'))
    expect(t.columnas['Sin seccional']).toBe(2)
    expect(t.columnasCampana['Sin seccional']).toBe(0)
  })

  it('una venta de una campana que la tabla de arriba no lista se pinta igual', () => {
    // No deberia pasar: la vista crea la fila (campana, mes) en cuanto hay una venta. Si
    // pasara, la venta tiene que verse — una fila fea es mejor que una venta que se
    // evapora sin que nadie lo note.
    const filas = ventasPorCiudad(lenteMes(CAMP, '2026-08-01'), [...NEG, n('Z', '2026-08-01', 'Cali')], '2026-08-01')
    const huerfana = filas.find(x => x.campaignId === 'Z')
    expect(huerfana?.total).toBe(1)
    expect(huerfana?.campana).toBe('Z')
    expect(totalesPorCiudad(filas).total).toBe(6)
  })
})

describe('drillSeAcotaAVentas', () => {
  it('una celda de ciudad en cohorte SOLO abre ventas', () => {
    // El defecto que evita: en cohorte, el panel de una campana lista todos sus negocios
    // a proposito ("todos los negocios de la campaña"). Una celda de ciudad cuenta solo
    // ventas, asi que sin este corte abriria 15 casos donde la celda dice 5.
    expect(drillSeAcotaAVentas({ campaignId: 'A', mes: null })).toBe(false)
    expect(drillSeAcotaAVentas({ campaignId: 'A', mes: null, columna: 'Medellín' })).toBe(true)
  })

  it('con mes no hace falta: la consulta ya filtra por `mes_venta`', () => {
    expect(drillSeAcotaAVentas({ campaignId: 'A', mes: '2026-08-01', columna: 'Medellín' })).toBe(false)
    expect(drillSeAcotaAVentas({ campaignId: null, mes: '2026-08-01' })).toBe(false)
  })

  it('sin rastro y sin mes sigue acotandose, como antes', () => {
    expect(drillSeAcotaAVentas({ campaignId: null, mes: null })).toBe(true)
  })
})
