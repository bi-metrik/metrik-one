import { describe, expect, it } from 'vitest'

import {
  cifrasPorRevisar,
  descripcionDeLinea,
  descripcionReescribible,
  fichaDeLinea,
  validarCorreccion,
  valorLegible,
} from './ficha-linea'
import { ranuraPorSlug } from './ranuras-pantallazo'
import { cargoLeidoDelItem } from './detalle-viaje'
import type { LecturaCasilla } from './tarifa-pasajero'

const HOTEL = ranuraPorSlug('hotel_detalle')!
const VUELO = ranuraPorSlug('vuelo_detalle')!
const def = (r: typeof HOTEL, slug: string) => r.campos.find(c => c.slug === slug)!

describe('validar lo que escribe una persona', () => {
  it('estrellas: entero de 1 a 5, nada de medias', () => {
    expect(validarCorreccion(def(HOTEL, 'estrellas'), '4')).toEqual({ ok: true, valor: '4' })
    expect(validarCorreccion(def(HOTEL, 'estrellas'), '4,5').ok).toBe(false)
    expect(validarCorreccion(def(HOTEL, 'estrellas'), '6').ok).toBe(false)
  })
  it('horas en HH:MM, aceptando am/pm', () => {
    expect(validarCorreccion(def(VUELO, 'hora_salida'), '7:45 pm')).toEqual({ ok: true, valor: '19:45' })
    expect(validarCorreccion(def(VUELO, 'hora_salida'), '07:45')).toEqual({ ok: true, valor: '07:45' })
    expect(validarCorreccion(def(VUELO, 'hora_salida'), 'mañana').ok).toBe(false)
  })
  it('fechas reales en AAAA-MM-DD', () => {
    expect(validarCorreccion(def(VUELO, 'fecha_salida'), '2026-10-23')).toEqual({ ok: true, valor: '2026-10-23' })
    expect(validarCorreccion(def(VUELO, 'fecha_salida'), '2026-02-30').ok).toBe(false)
    expect(validarCorreccion(def(VUELO, 'fecha_salida'), '23/10/2026').ok).toBe(false)
  })
  it('equipaje: sí o no', () => {
    expect(validarCorreccion(def(VUELO, 'equipaje_bodega'), 'false')).toEqual({ ok: true, valor: 'false' })
    expect(validarCorreccion(def(VUELO, 'equipaje_bodega'), 'Sí')).toEqual({ ok: true, valor: 'true' })
    expect(validarCorreccion(def(VUELO, 'equipaje_bodega'), 'tal vez').ok).toBe(false)
  })
  it('números enteros; las noches, mayores que cero', () => {
    expect(validarCorreccion(def(VUELO, 'escalas'), '0')).toEqual({ ok: true, valor: '0' })
    expect(validarCorreccion(def(HOTEL, 'noches'), '0').ok).toBe(false)
    expect(validarCorreccion(def(HOTEL, 'noches'), '2.5').ok).toBe(false)
  })
  it('montos con la coma o el punto de la pantalla', () => {
    expect(validarCorreccion(def(HOTEL, 'impuestos_destino_valor'), '329,44')).toEqual({ ok: true, valor: '329.44' })
    expect(validarCorreccion(def(HOTEL, 'impuestos_destino_valor'), '1.234,56')).toEqual({ ok: true, valor: '1234.56' })
  })
  it('una corrección «50.080» es cincuenta mil, igual que en la lectura', () => {
    expect(validarCorreccion(def(HOTEL, 'impuestos_destino_valor'), '50.080')).toEqual({ ok: true, valor: '50080' })
    expect(validarCorreccion(def(HOTEL, 'impuestos_destino_valor'), '-5').ok).toBe(false)
  })
  it('vacío es «vacío a propósito» (null), no un error', () => {
    expect(validarCorreccion(def(HOTEL, 'regimen'), '   ')).toEqual({ ok: true, valor: null })
  })
  it('un texto larguísimo no es un campo de ficha', () => {
    expect(validarCorreccion(def(HOTEL, 'regimen'), 'x'.repeat(201)).ok).toBe(false)
  })
})

describe('la ficha muestra lo leído, lo corregido y lo que falta', () => {
  it('cada campo corregible, con su lectura original aunque esté corregido', () => {
    const f = fichaDeLinea(HOTEL, [{ label: 'Régimen', valor: 'Todo incluido' }, { label: 'Estrellas', valor: '3' }], {
      regimen: { valor: 'Solo alojamiento', por: 'Daniela', porId: 'p', en: 'x' },
    })
    const regimen = f.find(c => c.slug === 'regimen')!
    expect(regimen).toMatchObject({ leido: 'Todo incluido', vigente: 'Solo alojamiento' })
    expect(regimen.correccion?.por).toBe('Daniela')
    expect(f.find(c => c.slug === 'estrellas')).toMatchObject({ leido: '3', vigente: '3', correccion: null })
    // Lo que no se leyó también está, para llenarlo en el mismo sitio.
    expect(f.find(c => c.slug === 'politica_cancelacion')).toMatchObject({ leido: null, vigente: null })
    // Lo que entra al costo no está.
    expect(f.some(c => c.slug === 'precio_total')).toBe(false)
  })
  it('los booleanos se leen como Sí / No', () => {
    expect(valorLegible('boolean', 'true')).toBe('Sí')
    expect(valorLegible('boolean', null)).toBe('—')
  })
})

function casilla(campos: { label: string; valor: string }[], descripcion: string, notas: string[] = []): LecturaCasilla {
  return {
    moneda: 'COP', total: 1, aPagarAgencia: null, porTipo: [],
    ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: 2 }, ocupacionDelItem: false,
    identidad: {}, notasCliente: notas, alertas: [], campos, nombre: 'n', descripcion, leidaEn: 'x',
  }
}

describe('la descripción de la línea', () => {
  const campos = [
    { label: 'Aerolínea', valor: 'Avianca' },
    { label: 'Salida', valor: '2026-10-23' },
    { label: 'Hora de salida (ida)', valor: '05:50' },
    { label: 'Escalas', valor: '0' },
  ]
  // La del vuelo se arma desde sus tramos (B3 del brief del 2026-09-23): la hora va pegada a
  // la fecha del tramo que la tiene.
  const leida = 'Ida: 2026-10-23 05:50 · Directo'

  it('sin correcciones es EXACTAMENTE la de antes: la de la casilla 1 y las notas', () => {
    const c = { grupo_completo: casilla(campos, leida, ['Nota A']), sin_infantes: casilla([], '', ['Nota A', 'Nota B']) }
    expect(descripcionDeLinea(VUELO, c, undefined)).toBe(`${leida} · Nota A · Nota B`)
    // Y con la casilla 1 sin descripción, cae a la que ya tenía la línea.
    expect(descripcionDeLinea(VUELO, { grupo_completo: casilla(campos, '') }, {}, 'LA MÍA')).toBe('LA MÍA')
  })

  it('reproduce la de la lectura cuando se rearma sin cambiar nada (misma función, mismos datos)', () => {
    // Una corrección que deja el MISMO valor rearma la descripción: tiene que salir igual.
    const c = { grupo_completo: casilla(campos, leida) }
    expect(descripcionDeLinea(VUELO, c, { aerolinea: { valor: 'Avianca', por: null, porId: null, en: 'x' } })).toBe(leida)
  })

  it('con una hora corregida, la descripción dice la hora nueva', () => {
    const c = { grupo_completo: casilla(campos, leida) }
    const d = descripcionDeLinea(VUELO, c, { hora_salida: { valor: '07:45', por: 'D', porId: 'p', en: 'x' } })
    expect(d).toBe('Ida: 2026-10-23 07:45 · Directo')
  })

  it('B2 · el cargo en destino ya no se copia a la descripción: vive en su campo', () => {
    // Antes la nota de la lectura se pegaba a la descripción y la corrección la reescribía:
    // el mismo dato en dos sitios, y el del texto se quedaba viejo (así llegó «50,08 COP»).
    const notaVieja = 'Impuestos y tasas a pagar en destino: 329,44 MXN, no incluidos en el precio.'
    const campos = [
      { label: 'Hotel', valor: 'Crown' },
      { label: 'Impuestos en destino', valor: '329.44' },
      { label: 'Moneda de los impuestos en destino', valor: 'MXN' },
    ]
    const c = { grupo_completo: casilla(campos, 'x', [notaVieja, 'Desayuno para dos']) }
    const correcciones = { impuestos_destino_valor: { valor: '400', por: null, porId: null, en: 'x' } }
    const d = descripcionDeLinea(HOTEL, c, correcciones)
    expect(d).not.toContain('Impuestos y tasas a pagar en destino')
    // Las demás notas de la lectura siguen.
    expect(d).toContain('Desayuno para dos')
    // Y el cargo corregido es el que queda en el campo propio de la opción.
    const item = { nombre: 'CROWN', grupo: 'hotel', tarifa_pax: { casillas: c, correcciones } }
    expect(cargoLeidoDelItem(item)).toEqual({ valor: 400, moneda: 'MXN' })
  })
})

describe('cuándo el sistema puede reescribir la descripción', () => {
  it('vacía, siempre', () => expect(descripcionReescribible('', 'X', true)).toBe(true))
  it('si sigue siendo la que escribió el sistema, sí; si alguien la cambió, no', () => {
    expect(descripcionReescribible('SALIDA 05:50', 'SALIDA 05:50', true)).toBe(true)
    expect(descripcionReescribible('Vuelo nocturno, pedir silla', 'SALIDA 05:50', true)).toBe(false)
  })
  it('sin marca: confirmada antes de la marca → como antes; nunca confirmada → la escribió una persona', () => {
    expect(descripcionReescribible('lo que sea', undefined, true)).toBe(true)
    expect(descripcionReescribible('lo que sea', undefined, false)).toBe(false)
  })
})

describe('«revisa esta cifra» · el piso de verosimilitud de los montos en pesos', () => {
  const lectura = (impuesto: string, moneda: string | null = 'COP', precio = '8258260') => [
    { label: 'Hotel', valor: 'Riu Caribe' },
    { label: 'Moneda', valor: 'COP' },
    { label: 'Precio', valor: precio },
    { label: 'Impuestos en destino', valor: impuesto },
    ...(moneda ? [{ label: 'Moneda de los impuestos en destino', valor: moneda }] : []),
  ]

  it('marca un monto en pesos menor a mil, y solo ese', () => {
    expect([...cifrasPorRevisar(HOTEL, lectura('50,08'), undefined)]).toEqual(['impuestos_destino_valor'])
    expect(cifrasPorRevisar(HOTEL, lectura('50.080'), undefined).size).toBe(0)
  })

  it('la ficha lo dice en el campo que se corrige', () => {
    const f = fichaDeLinea(HOTEL, lectura('64,2'), undefined)
    expect(f.find(c => c.slug === 'impuestos_destino_valor')?.revisarCifra).toBe(true)
    expect(f.find(c => c.slug === 'regimen')?.revisarCifra).toBe(false)
  })

  it('otra moneda no se mide contra pesos', () => {
    expect(cifrasPorRevisar(HOTEL, lectura('329.44', 'MXN'), undefined).size).toBe(0)
  })

  it('los impuestos sin moneda propia se miden en la de la captura', () => {
    expect(cifrasPorRevisar(HOTEL, lectura('50,08', null), undefined).size).toBe(1)
  })

  it('sin ninguna moneda leída manda la de la lectura (la supuesta no se lista como leída)', () => {
    const sinMonedas = lectura('50,08', null).filter(c => c.label !== 'Moneda')
    expect(cifrasPorRevisar(HOTEL, sinMonedas, undefined, 'COP').size).toBe(1)
    expect(cifrasPorRevisar(HOTEL, sinMonedas, undefined, 'USD').size).toBe(0)
    expect(cifrasPorRevisar(HOTEL, sinMonedas, undefined).size).toBe(0)
  })

  it('lo que corrigió una persona ya no se marca: la decisión es suya', () => {
    const corregido = { impuestos_destino_valor: { valor: '500', por: 'Ana', porId: null, en: '2026-09-23' } }
    expect(cifrasPorRevisar(HOTEL, lectura('50,08'), corregido).size).toBe(0)
  })

  it('también los montos de costo, que se corrigen en los rubros pero se ven en la ficha', () => {
    expect([...cifrasPorRevisar(HOTEL, lectura('50.080', 'COP', '825'), undefined)]).toEqual(['precio_total'])
  })
})
