import { describe, expect, it } from 'vitest'

import { aceptacionPrevia, idAceptacionValido } from './aceptacion-idempotente'
import type { LecturaCasilla } from './tarifa-pasajero'

/**
 * Caso Alejandra (2026-10-05): un «Aceptar» que se reintenta porque se perdió la respuesta no
 * puede crear otra opción ni otra habitación con el mismo pantallazo.
 */
const lectura = (aceptacion?: string): LecturaCasilla => ({
  total: 100, moneda: 'COP', aPagarAgencia: null, porTipo: [],
  ocupacion: { adultos: 2, ninos: 0, infantes: 0, total: 2 }, ocupacionDelItem: false,
  identidad: {}, notasCliente: [], alertas: [], campos: [], nombre: '', descripcion: '', leidaEn: '2026-10-05T00:00:00Z',
  ...(aceptacion ? { aceptacion } : {}),
})

const linea = (id: string, grupo: string, tarifa: unknown) => ({ id, grupo, es_ajuste: false, tarifa_pax: tarifa })

describe('aceptacionPrevia', () => {
  const LLAVE = 'cap-mg1x2-3-abcd1234'
  it('sin llave, o con una que nadie tiene: no hay aceptación previa', () => {
    const ls = [linea('i1', 'hotel', { casillas: { grupo_completo: lectura('otra-llave-1') } })]
    expect(aceptacionPrevia(ls, null)).toBeNull()
    expect(aceptacionPrevia(ls, LLAVE)).toBeNull()
  })

  it('la opción cuyo pantallazo 1 la tiene; `sola` si es la única de su bloque', () => {
    const ls = [linea('i1', 'hotel', { casillas: { grupo_completo: lectura(LLAVE) } })]
    expect(aceptacionPrevia(ls, LLAVE)).toEqual({ itemId: 'i1', como: 'opcion', sola: true })
    ls.push(linea('i2', 'hotel', { casillas: { grupo_completo: lectura() } }))
    expect(aceptacionPrevia(ls, LLAVE)).toEqual({ itemId: 'i1', como: 'opcion', sola: false })
  })

  it('la habitación que la tiene, con su id', () => {
    const ls = [linea('i1', 'hotel', {
      casillas: { grupo_completo: lectura('primera-llave') },
      habitaciones: [{ id: 'h1', lectura: lectura('primera-llave') }, { id: 'h2', lectura: lectura(LLAVE) }],
    })]
    expect(aceptacionPrevia(ls, LLAVE)).toEqual({ itemId: 'i1', como: 'habitacion', habitacionId: 'h2' })
    // La primera habitación ES el pantallazo 1 de la opción: cuenta como la opción.
    expect(aceptacionPrevia(ls, 'primera-llave')).toEqual({ itemId: 'i1', como: 'opcion', sola: true })
  })

  it('el ajuste no cuenta', () => {
    expect(aceptacionPrevia([{ id: 'a', grupo: null, es_ajuste: true, tarifa_pax: { casillas: { grupo_completo: lectura(LLAVE) } } }], LLAVE)).toBeNull()
  })
})

describe('idAceptacionValido', () => {
  it('acepta el id de la captura y rechaza lo demás', () => {
    expect(idAceptacionValido('cap-mg1x2-3-abcd1234')).toBe('cap-mg1x2-3-abcd1234')
    expect(idAceptacionValido('corto')).toBeNull()
    expect(idAceptacionValido('con espacio y más')).toBeNull()
    expect(idAceptacionValido(42)).toBeNull()
    expect(idAceptacionValido('x'.repeat(81))).toBeNull()
  })
})
