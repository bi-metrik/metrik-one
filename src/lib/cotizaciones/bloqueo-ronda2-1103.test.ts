import { describe, expect, it } from 'vitest'

import { ESQUEMA_HOTEL_BLOQUEO, PROMPT_HOTEL_BLOQUEO, hotelDesdeLectura } from './bloqueo-extraccion'
import {
  FALTA_TARIFA_POR_ELEGIR,
  costoDelPaquete,
  faltasDelPaquete,
  leerPaqueteBloqueo,
  paqueteVacio,
  rangoNinoParaEdad,
  type HotelBloqueo,
  type PaqueteBloqueo,
} from './bloqueo-paquete'
import { grupoDelPaqueteVigente, paquetesConTarifaPorElegir } from './bloqueo-armado'
import { grupoDeRanura } from './ranuras-cotizacion'
import { KORAY, VUELO_AV, VUELO_OTRO } from './__fixtures__/bloqueo/san-andres-1103'
import { PARAISO_TAYRONA, RODADERO_DORADO } from './__fixtures__/bloqueo/santa-marta-1103'

/**
 * Paquetes de bloqueo, segunda ronda (Trappvel, 2026-11-03): CHD por rango de edad, la pregunta
 * «¿Pública o Neta?» por paquete y «+ Paquete» al paquete vigente. Cifras de los pantallazos de ATN.
 */

function paquete(h: HotelBloqueo, d: PaqueteBloqueo['distribucion']): PaqueteBloqueo {
  return { ...paqueteVacio('ATN'), hotel: h, vuelo: VUELO_AV, distribucion: d }
}

describe('CHD por rango de edad: la lectura trae todos los rangos', () => {
  const raw = {
    es_oferta_de_hotel: true,
    hotel: 'Koray Hotel',
    precios_por_persona: [{ acomodacion: 'triple', precio: 2441205 }, { acomodacion: 'doble', precio: 2489985 }],
    nino: { precio: 1124132, edad_min: 2, edad_max: 3 },
    ninos_por_edad: [{ precio: 1124132, edad_min: 2, edad_max: 3 }, { precio: 2246083, edad_min: 4, edad_max: 11 }],
    iconos: [],
    incluye_por_texto: [],
  }

  it('el prompt y el esquema piden los rangos (CHD 2-3 / 4-11, 02-04 / 5-10)', () => {
    expect(PROMPT_HOTEL_BLOQUEO).toContain('ninos_por_edad')
    expect(PROMPT_HOTEL_BLOQUEO).toContain('CHD 5-10')
    expect(ESQUEMA_HOTEL_BLOQUEO.properties).toHaveProperty('ninos_por_edad')
  })

  it('con dos rangos: ninosPorEdad trae los dos y nino es el primero', () => {
    const h = hotelDesdeLectura(raw)
    if (!h.ok) throw new Error(h.motivo)
    expect(h.hotel.ninosPorEdad).toEqual([{ precio: 1124132, edadMin: 2, edadMax: 3 }, { precio: 2246083, edadMin: 4, edadMax: 11 }])
    expect(h.hotel.nino).toEqual({ precio: 1124132, edadMin: 2, edadMax: 3 })
  })

  it('con un solo rango, como siempre: sin ninosPorEdad (los fixtures de antes no cambian)', () => {
    const h = hotelDesdeLectura({ ...raw, ninos_por_edad: [raw.ninos_por_edad[0]] })
    if (!h.ok) throw new Error(h.motivo)
    expect(h.hotel).not.toHaveProperty('ninosPorEdad')
    expect(h.hotel.nino).toEqual({ precio: 1124132, edadMin: 2, edadMax: 3 })
    const sin = hotelDesdeLectura({ ...raw, ninos_por_edad: undefined })
    expect(sin.ok && sin.hotel).not.toHaveProperty('ninosPorEdad')
  })

  it('la lectura guardada conserva los rangos y la pregunta (toda llave que no se lea se pierde)', () => {
    const p = { ...paquete(KORAY, { habitaciones: { doble: 1 }, ninos: 2, infantes: 0, edadesNinos: [3, 8] }), tarifaPorElegir: true }
    const leido = leerPaqueteBloqueo(JSON.parse(JSON.stringify(p)))!
    expect(leido.hotel.ninosPorEdad).toEqual(KORAY.ninosPorEdad)
    expect(leido.tarifaPorElegir).toBe(true)
    const sinPregunta = leerPaqueteBloqueo(JSON.parse(JSON.stringify(paquete(PARAISO_TAYRONA, { habitaciones: { doble: 1 }, ninos: 0 }))))!
    expect(sinPregunta).not.toHaveProperty('tarifaPorElegir')
    expect(sinPregunta.hotel).not.toHaveProperty('ninosPorEdad')
  })
})

describe('CHD por rango de edad: cada niño paga el rango de su edad (edades_menores de la Solicitud)', () => {
  it('Koray, 2 adultos en Doble + niños de 3 y 8: 2 × 2.489.985 + 1.124.132 + 2.246.083', () => {
    const c = costoDelPaquete(paquete(KORAY, { habitaciones: { doble: 1 }, ninos: 2, infantes: 0, edadesNinos: [3, 8] }))
    expect(c.total).toBe(2 * 2489985 + 1124132 + 2246083)
    expect(c.filas.filter(f => f.clave === 'nino').map(f => [f.etiqueta, f.personas, f.total])).toEqual([
      ['Niño (CHD 2-3 años)', 1, 1124132],
      ['Niño (CHD 4-11 años)', 1, 2246083],
    ])
  })

  it('Rodadero Dorado (CHD 02-04 y 5-10): niños de 4 y 7 → 931.506 + 1.425.177', () => {
    const c = costoDelPaquete(paquete(RODADERO_DORADO, { habitaciones: { doble: 1 }, ninos: 2, infantes: 0, edadesNinos: [4, 7] }))
    expect(c.total).toBe(2 * 1653025 + 931506 + 1425177)
  })

  it('dos niños del mismo rango van en una fila', () => {
    const c = costoDelPaquete(paquete(KORAY, { habitaciones: { doble: 1 }, ninos: 2, infantes: 0, edadesNinos: [5, 9] }))
    expect(c.filas.filter(f => f.clave === 'nino')).toEqual([expect.objectContaining({ personas: 2, total: 2 * 2246083 })])
  })

  it('rangos que se pisan: gana el más estrecho', () => {
    const h: HotelBloqueo = { ...KORAY, ninosPorEdad: [{ precio: 100, edadMin: 2, edadMax: 11 }, { precio: 50, edadMin: 2, edadMax: 3 }] }
    expect(rangoNinoParaEdad(h, 3)?.precio).toBe(50)
    expect(rangoNinoParaEdad(h, 7)?.precio).toBe(100)
  })

  it('una edad fuera de todos los rangos frena con los rangos del operador', () => {
    const p = paquete(RODADERO_DORADO, { habitaciones: { doble: 1 }, ninos: 1, infantes: 0, edadesNinos: [12] })
    const f = faltasDelPaquete(p, { adultos: 2, ninos: 1, infantes: 0 })
    expect(f.map(x => x.clave)).toContain('nino_fuera_de_rango')
    expect(f.find(x => x.clave === 'nino_fuera_de_rango')!.texto).toContain('CHD 2-4 años, CHD 5-10 años')
  })

  it('sin la edad de cada niño no hay costo: no se adivina el rango', () => {
    const p = paquete(KORAY, { habitaciones: { doble: 1 }, ninos: 1, infantes: 0, edadesNinos: [] })
    expect(costoDelPaquete(p).total).toBeNull()
    expect(faltasDelPaquete(p, { adultos: 2, ninos: 1, infantes: 0 }).map(x => x.clave)).toEqual(expect.arrayContaining(['falta_costo', 'nino_sin_edad']))
  })

  it('un solo rango sigue como siempre: CHD 02-07 a 1.140.366', () => {
    const c = costoDelPaquete(paquete(PARAISO_TAYRONA, { habitaciones: { doble: 1 }, ninos: 1, infantes: 0, edadesNinos: [5] }))
    expect(c.total).toBe(2 * 1520113 + 1140366)
  })
})

describe('«¿Pública o Neta?» abierta frena el envío', () => {
  it('es una falta del paquete con su texto', () => {
    const p = { ...paquete(KORAY, { habitaciones: { triple: 1 }, ninos: 0, infantes: 0 }), tarifaPorElegir: true }
    expect(faltasDelPaquete(p, { adultos: 3, ninos: 0, infantes: 0 })).toEqual([{ clave: 'tarifa_por_elegir', texto: FALTA_TARIFA_POR_ELEGIR }])
    const { tarifaPorElegir: _t, ...respondido } = p
    void _t
    expect(faltasDelPaquete(respondido, { adultos: 3, ninos: 0, infantes: 0 })).toEqual([])
  })

  it('la bandeja pregunta UNA vez por paquete, en orden, con su vuelo en el título', () => {
    const g1 = grupoDeRanura({ tipo: 'paquete', numero: null, nombre: 'Paquete de bloqueo en San Andrés' })
    const g2 = grupoDeRanura({ tipo: 'paquete', numero: 2, nombre: 'Paquete de bloqueo en San Andrés' })
    const con = (v: typeof VUELO_AV) => ({ ...paqueteVacio('ATN'), vuelo: v, tarifaPorElegir: true })
    const sin = { ...paqueteVacio('ATN'), vuelo: VUELO_AV }
    expect(paquetesConTarifaPorElegir([
      { id: 'b1', grupo: g2, paquete: con(VUELO_OTRO) },
      { id: 'a1', grupo: g1, paquete: con(VUELO_AV) },
      { id: 'a2', grupo: g1, paquete: con(VUELO_AV) },
      { id: 'b2', grupo: g2, paquete: sin },
      { id: 'h', grupo: 'hotel', paquete: con(VUELO_AV) },
    ])).toEqual([{ itemId: 'a1', titulo: 'Paquete 1 · AV 9376' }, { itemId: 'b1', titulo: 'Paquete 2 · AV 9370' }])
    expect(paquetesConTarifaPorElegir([{ id: 'a1', grupo: g1, paquete: sin }])).toEqual([])
  })
})

describe('«+ Paquete» va al paquete vigente (el de número más alto)', () => {
  it('con los paquetes 1 y 2, el 2; sin paquetes, ninguno', () => {
    const g1 = grupoDeRanura({ tipo: 'paquete', numero: null, nombre: 'Paquete de bloqueo en San Andrés' })
    const g2 = grupoDeRanura({ tipo: 'paquete', numero: 2, nombre: 'Paquete de bloqueo en San Andrés' })
    expect(grupoDelPaqueteVigente([{ grupo: g1 }, { grupo: g2 }, { grupo: g1 }])).toBe(g2)
    expect(grupoDelPaqueteVigente([{ grupo: g2 }, { grupo: g1 }])).toBe(g2)
    expect(grupoDelPaqueteVigente([{ grupo: g1 }, { grupo: g2, es_ajuste: true }])).toBe(g1)
    expect(grupoDelPaqueteVigente([{ grupo: 'hotel' }])).toBeNull()
  })
})
