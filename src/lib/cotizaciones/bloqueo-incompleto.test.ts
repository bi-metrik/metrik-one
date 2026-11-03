import { describe, expect, it } from 'vitest'

import aliadosHotel from './__fixtures__/bloqueo/aliados-hotel.json'
import { hotelDesdeLectura } from './bloqueo-extraccion'
import { paqueteVacio, type PaqueteBloqueo } from './bloqueo-paquete'
import { motivoPaquetesIncompletos, paquetesIncompletos } from './bloqueo-incompleto'
import { listaUnica, type EntradaDeLista } from './lista-unica'

/**
 * Un paquete incompleto frena «Enviar» y entra a «Revisar» (QA del 2026-10-29), en los cuatro casos:
 * costo 0, infante sin costo, niño fuera del rango CHD y acomodación sin precio.
 */

const GRUPO = 'paquete de bloqueo: Paquete de bloqueo en San Andrés'

/** Un paquete completo: 2 dobles (4 adultos), 1 niño de 7 dentro del rango CHD. */
function completo(): PaqueteBloqueo {
  const h = hotelDesdeLectura(aliadosHotel)
  if (!h.ok) throw new Error('fixture ilegible')
  const p: PaqueteBloqueo = { ...paqueteVacio('Aliados Travel'), hotel: h.hotel, incluye: h.incluye }
  // Solo las acomodaciones que se venden, todas con precio.
  p.hotel.precios = p.hotel.precios.filter(x => x.acomodacion === 'doble')
  p.hotel.nino = { precio: 900_000, edadMin: 2, edadMax: 11 }
  p.distribucion = { habitaciones: { doble: 2 }, ninos: 1, infantes: 0, edadesNinos: [7] }
  return p
}

const linea = (id: string, p: PaqueteBloqueo | null) => ({ id, nombre: 'OPCIÓN 1', grupo: GRUPO, es_ajuste: false, tarifa_pax: p ? { bloqueo: p } : null })
const VIAJE = { adultos: 4, ninos: 1, infantes: 0 }

describe('paquete incompleto', () => {
  it('completo: no frena', () => {
    expect(paquetesIncompletos([linea('a', completo())], null, VIAJE)).toEqual([])
  })

  it('1 · costo 0 (la COT-2026-0007: tres paquetes sin guardar) dice «Falta el costo del paquete», no margen', () => {
    const r = paquetesIncompletos([linea('a', null), linea('b', null), linea('c', null)], null, VIAJE)
    expect(r.map(x => x.itemId)).toEqual(['a', 'b', 'c'])
    const motivo = motivoPaquetesIncompletos(r)!
    expect(motivo).toMatch(/^Falta el costo del paquete «Paquete 1» y 2 paquetes más\./)
    expect(motivo).not.toMatch(/margen|mínimo/i)
    // Guardado pero sin habitaciones repartidas: también es costo 0.
    const sinReparto = completo()
    sinReparto.distribucion = { habitaciones: {}, ninos: 0, infantes: 0, edadesNinos: [] }
    const m2 = motivoPaquetesIncompletos(paquetesIncompletos([linea('a', sinReparto)], null, { adultos: 4, ninos: 0, infantes: 0 }))
    expect(m2).toBe('Falta el costo del paquete «Hotel Cartagena Dubai». Pon cuántas habitaciones de cada acomodación toma el grupo.')
  })

  it('2 · un infante sin costo', () => {
    const r = paquetesIncompletos([linea('a', completo())], null, { ...VIAJE, infantes: 1 })
    expect(r[0].faltas.map(f => f.clave)).toEqual(['infantes'])
    expect(motivoPaquetesIncompletos(r)).toMatch(/infante/)
    // Con su costo escrito (0 = no paga) ya no frena.
    const conCosto = completo()
    conCosto.hotel.infante = { precio: 0 }
    expect(paquetesIncompletos([linea('a', conCosto)], null, { ...VIAJE, infantes: 1 })).toEqual([])
  })

  it('3 · un niño fuera del rango CHD', () => {
    const p = completo()
    p.distribucion.edadesNinos = [13]
    const r = paquetesIncompletos([linea('a', p)], null, VIAJE)
    expect(r[0].faltas.map(f => f.clave)).toEqual(['nino_fuera_de_rango'])
    expect(r[0].faltas[0].texto).toContain('13 años')
    expect(r[0].faltas[0].texto).toContain('2-11 años')
  })

  it('un niño sin edad escrita frena: «Falta la edad de un niño»', () => {
    const p = completo()
    p.distribucion.ninos = 2
    p.hotel.nino = { precio: 900_000, edadMin: 2, edadMax: 11 }
    const r = paquetesIncompletos([linea('a', p)], null, { ...VIAJE, ninos: 2 })
    expect(r[0].faltas.map(f => f.clave)).toEqual(['nino_sin_edad'])
    expect(motivoPaquetesIncompletos(r)).toBe('Paquete «Hotel Cartagena Dubai» incompleto: Falta la edad de un niño.')
    p.distribucion.edadesNinos = [7, 9]
    expect(paquetesIncompletos([linea('a', p)], null, { ...VIAJE, ninos: 2 })).toEqual([])
  })

  it('4 · una acomodación sin precio', () => {
    const p = completo()
    p.hotel.precios.push({ acomodacion: 'triple', precioPorPersona: null })
    const r = paquetesIncompletos([linea('a', p)], null, VIAJE)
    expect(r[0].faltas.map(f => f.clave)).toEqual(['acomodacion_sin_precio'])
    // Repartida sin precio: el costo no se puede sacar, y lo dice como costo.
    p.distribucion.habitaciones.triple = 1
    const r2 = paquetesIncompletos([linea('a', p)], null, VIAJE)
    expect(r2[0].faltas[0].clave).toBe('falta_costo')
    expect(r2[0].faltas[0].texto).toContain('triple')
  })

  it('con tarifas marcadas solo cuentan los paquetes que van al cliente', () => {
    const lineas = [linea('a', completo()), linea('b', null)]
    expect(paquetesIncompletos(lineas, new Set(['a']), VIAJE)).toEqual([])
    expect(paquetesIncompletos(lineas, new Set(['a', 'b']), VIAJE).map(x => x.itemId)).toEqual(['b'])
  })
})

describe('«Revisar y enviar»: el paquete impide enviar, con su «Ir», y no se dice como margen', () => {
  const base: EntradaDeLista = {
    sinPrecio: [], capturas: null, tarifas: [],
    // La salida que veía la COT-2026-0007: margen sin dato = «bajo el mínimo».
    salida: { aplica: true, bloquea: true, faltaCosto: null, excepcion: null, lineas: 3, lineasSinCosto: 0, pisoPct: 12, bajoMinimo: [] } as never,
    pantallazosPorAceptar: 0, texto: 'nada', noVan: [], faltaDia: null, margenBajoAviso: null, recargo: null, viaje: null, ivaSinCalcular: null,
  }
  it('sin paquetes incompletos, lo de siempre (el margen)', () => {
    expect(listaUnica(base).impide.map(r => r.clave)).toEqual(['margen'])
  })
  it('con uno sin costo, impide el paquete y el margen no aparece', () => {
    const paquetes = paquetesIncompletos([linea('pq-1', null)], null, VIAJE)
    const l = listaUnica({ ...base, paquetes })
    expect(l.impide.map(r => r.clave)).toEqual(['paquete-incompleto'])
    expect(l.impide[0].texto).toMatch(/^Falta el costo del paquete/)
    expect(l.impide[0].ir).toEqual({ a: 'opcion', itemId: 'pq-1' })
  })
})
