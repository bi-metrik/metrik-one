import { describe, expect, it } from 'vitest'

import { monedaDeFila, revisarAjustesMoneda, tarifasParaCotizar, vigenciaParaCerrar, type ExtraccionCargada } from './tarifas-extraidas'

/** Un tarifario de cadena ficticio: tres hoteles en un PDF, uno en dólares. */
const TARIFARIO = {
  moneda: 'COP',
  vigencia: { desde: '2027-01-01', hasta: '2027-12-31', texto: 'Tarifas válidas 2027', fuente: 'contenido', requiere_confirmacion: false },
  tarifas: [
    { establecimiento: 'Cadena Ficticia Centro', categoria: 'Estándar', precio: 300000, moneda: 'COP' },
    { establecimiento: 'Cadena Ficticia Centro', categoria: 'Superior', precio: 380000, moneda: 'COP' },
    { establecimiento: 'Cadena Ficticia Playa', categoria: 'Estándar', precio: 350000, moneda: 'COP' },
    { establecimiento: 'Cadena Ficticia Cancún', categoria: 'Estándar', precio: 180, moneda: 'COP' },
    { establecimiento: null, categoria: 'Traslado aeropuerto', precio: 90000, moneda: 'COP' },
  ],
}

const cargada = (cambios: Partial<ExtraccionCargada> = {}): ExtraccionCargada => ({
  estado: 'revisada',
  vigenciaDesde: '2027-01-01',
  vigenciaHasta: '2027-12-31',
  tarifario: TARIFARIO,
  monedas: {},
  ...cambios,
})

describe('vigencia obligatoria al cerrar la carga', () => {
  const porConfirmar = { ...TARIFARIO, vigencia: { desde: null, hasta: null, texto: null, fuente: 'ninguna', requiere_confirmacion: true } }
  const delNombre = { ...TARIFARIO, vigencia: { desde: '2027-01-01', hasta: '2027-12-31', texto: null, fuente: 'nombre_archivo', requiere_confirmacion: true } }

  it('sin vigencia del motor, la carga no se cierra hasta que la persona escriba las fechas', () => {
    expect(vigenciaParaCerrar(porConfirmar, {})).toMatchObject({ ok: false, error: expect.stringMatching(/escribe la vigencia/) })
    expect(vigenciaParaCerrar(porConfirmar, { desde: '2027-01-01' })).toMatchObject({ ok: false, error: expect.stringMatching(/las dos fechas/) })
    expect(vigenciaParaCerrar(porConfirmar, { desde: '2027-02-30', hasta: '2027-12-31' })).toMatchObject({ ok: false })
    expect(vigenciaParaCerrar(porConfirmar, { desde: '2027-12-31', hasta: '2027-01-01' })).toMatchObject({ ok: false, error: expect.stringMatching(/antes/) })
    expect(vigenciaParaCerrar(porConfirmar, { desde: '2027-01-01', hasta: '2027-06-30' })).toEqual({ ok: true, desde: '2027-01-01', hasta: '2027-06-30', por: 'persona' })
  })

  it('un año que sale solo del nombre del archivo también se confirma (no se infiere)', () => {
    expect(vigenciaParaCerrar(delNombre, null)).toMatchObject({ ok: false })
    expect(vigenciaParaCerrar(delNombre, { desde: '2027-01-01', hasta: '2027-12-31' })).toEqual({ ok: true, desde: '2027-01-01', hasta: '2027-12-31', por: 'persona' })
  })

  it('con vigencia del documento se cierra con ella, y la persona la puede corregir', () => {
    expect(vigenciaParaCerrar(TARIFARIO, {})).toEqual({ ok: true, desde: '2027-01-01', hasta: '2027-12-31', por: 'motor' })
    expect(vigenciaParaCerrar(TARIFARIO, { desde: '2027-01-01', hasta: '2027-12-31' })).toEqual({ ok: true, desde: '2027-01-01', hasta: '2027-12-31', por: 'motor' })
    expect(vigenciaParaCerrar(TARIFARIO, { desde: '2027-01-15', hasta: '2027-12-31' })).toEqual({ ok: true, desde: '2027-01-15', hasta: '2027-12-31', por: 'persona' })
  })
})

describe('moneda por tarifario, establecimiento o fila', () => {
  it('manda la más específica: fila > establecimiento > tarifario > motor', () => {
    const fila = TARIFARIO.tarifas[3]
    expect(monedaDeFila(fila, 3, TARIFARIO, {})).toBe('COP')
    expect(monedaDeFila(fila, 3, TARIFARIO, { tarifario: 'EUR' })).toBe('EUR')
    // Por establecimiento, sin importar tildes ni mayúsculas.
    expect(monedaDeFila(fila, 3, TARIFARIO, { tarifario: 'EUR', establecimientos: { 'cadena ficticia CANCÚN': 'USD' } })).toBe('USD')
    expect(monedaDeFila(fila, 3, TARIFARIO, { tarifario: 'EUR', establecimientos: { 'Cadena Ficticia Cancún': 'USD' }, filas: { '3': 'MXN' } })).toBe('MXN')
    // Sin moneda en la fila (0.2): la del tarifario.
    expect(monedaDeFila({ precio: 1 }, 0, { moneda: 'USD' }, null)).toBe('USD')
    expect(monedaDeFila({ precio: 1 }, 0, {}, null)).toBeNull()
  })

  it('los cambios se revisan contra el tarifario', () => {
    expect(revisarAjustesMoneda({ tarifario: 'USD', establecimientos: { 'Cadena Ficticia Cancún': 'USD' }, filas: { '4': 'EUR' } }, TARIFARIO)).toEqual({
      ok: true,
      ajustes: { tarifario: 'USD', establecimientos: { 'Cadena Ficticia Cancún': 'USD' }, filas: { '4': 'EUR' } },
    })
    expect(revisarAjustesMoneda(null, TARIFARIO)).toEqual({ ok: true, ajustes: {} })
    expect(revisarAjustesMoneda({ tarifario: 'ARS' }, TARIFARIO)).toMatchObject({ ok: false })
    expect(revisarAjustesMoneda({ establecimientos: { 'Hotel Inexistente': 'USD' } }, TARIFARIO)).toMatchObject({ ok: false, error: expect.stringMatching(/Hotel Inexistente/) })
    expect(revisarAjustesMoneda({ filas: { '9': 'USD' } }, TARIFARIO)).toMatchObject({ ok: false })
    expect(revisarAjustesMoneda({ filas: { x: 'USD' } }, TARIFARIO)).toMatchObject({ ok: false })
  })

  it('cambiar la moneda de un establecimiento cambia solo sus filas al cotizar', () => {
    const r = tarifasParaCotizar(cargada({ monedas: { establecimientos: { 'Cadena Ficticia Cancún': 'USD' } } }), 'Cadena Ficticia Cancún')
    expect(r).toMatchObject({ ok: true, tarifas: [{ indice: 3, moneda: 'USD', precio: 180 }] })
    const otro = tarifasParaCotizar(cargada({ monedas: { establecimientos: { 'Cadena Ficticia Cancún': 'USD' } } }), 'Cadena Ficticia Centro')
    expect(otro.ok && otro.tarifas.map((t) => t.moneda)).toEqual(['COP', 'COP'])
  })
})

describe('qué cuenta para cotizar', () => {
  it('sin la carga cerrada o sin vigencia confirmada, nada', () => {
    expect(tarifasParaCotizar(cargada({ estado: 'borrador' }), 'Cadena Ficticia Centro')).toEqual({ ok: false, motivo: 'sin_cerrar' })
    expect(tarifasParaCotizar(cargada({ vigenciaHasta: null }), 'Cadena Ficticia Centro')).toEqual({ ok: false, motivo: 'sin_vigencia' })
  })

  it('un tarifario de cadena exige elegir el establecimiento; solo sus filas cuentan', () => {
    expect(tarifasParaCotizar(cargada(), null)).toEqual({ ok: false, motivo: 'elegir_establecimiento' })
    const centro = tarifasParaCotizar(cargada(), 'cadena ficticia centro')
    expect(centro.ok && centro.tarifas.map((t) => t.indice)).toEqual([0, 1])
    const playa = tarifasParaCotizar(cargada(), 'Cadena Ficticia Playa')
    expect(playa.ok && playa.tarifas.map((t) => t.indice)).toEqual([2])
    expect(tarifasParaCotizar(cargada(), 'Hotel que ya no está')).toEqual({ ok: false, motivo: 'establecimiento_no_esta' })
  })

  it('un tarifario de un solo establecimiento (o sin establecimientos) cuenta entero', () => {
    const uno = { ...TARIFARIO, tarifas: [{ categoria: 'Estándar', precio: 100000, moneda: 'COP' }, { categoria: 'Suite', precio: 'consultar', moneda: 'COP' }] }
    const r = tarifasParaCotizar(cargada({ tarifario: uno }), null)
    // La fila sin precio numérico no cuenta.
    expect(r.ok && r.tarifas.map((t) => t.indice)).toEqual([0])
  })
})
