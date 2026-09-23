/**
 * La regla de agrupación de la bandeja (P7), con lo que el detector REAL respondió a las 8
 * capturas del caso Providencia (`providencia-deteccion.fixture.json`, leído el 2026-09-23
 * con el mismo modelo y prompt que producción).
 */
import { describe, expect, it } from 'vitest'

import fixture from './providencia-deteccion.fixture.json'
import {
  estadoDeBloque,
  lugarComparable,
  mismoLugar,
  resumenDeBloques,
  ubicarCaptura,
  type CapturaDetectada,
  type RanuraCandidata,
} from './bandeja-capturas'

const DETECCION = fixture as unknown as Record<string, CapturaDetectada>
const ORDEN = [
  '01-vuelo1-bog-adz-avianca.png', '02-vuelo1-bog-adz-latam.png', '03-vuelo1-bog-adz-wingo.png',
  '04-vuelo2-adz-pva-satena-manana.png', '05-vuelo2-adz-pva-satena-tarde.png',
  '06-hotel-providencia-deep-blue.png', '07-hotel-providencia-sirius.png', '08-hotel-providencia-agua-dulce.png',
]

/** Pega las capturas en orden, como la bandeja: cada una se ubica contra lo que ya existe. */
function pegar(archivos: string[]) {
  const ranuras: RanuraCandidata[] = []
  const opciones = new Map<string, string[]>()
  for (const a of archivos) {
    const c = DETECCION[a]
    const u = ubicarCaptura(c, ranuras)
    let grupo: string
    if (u.como === 'hermana') {
      grupo = u.grupo
    } else {
      grupo = `${c.tipo} ${ranuras.filter(r => r.tipo === c.tipo).length + 1}`
      ranuras.push({ grupo, tipo: c.tipo, lugar: c.lugar, origen: c.origen, destino: c.destino })
    }
    opciones.set(grupo, [...(opciones.get(grupo) ?? []), a])
  }
  return opciones
}

describe('P7 · las 8 capturas de Providencia', () => {
  it('Vuelo 1 con 3 opciones, Vuelo 2 con 2 y Hotel con 3', () => {
    const r = pegar(ORDEN)
    expect([...r.entries()].map(([g, o]) => [g, o.length])).toEqual([
      ['vuelo 1', 3],
      ['vuelo 2', 2],
      ['hotel 1', 3],
    ])
    expect(r.get('vuelo 1')).toEqual(ORDEN.slice(0, 3))
    expect(r.get('vuelo 2')).toEqual(ORDEN.slice(3, 5))
  })

  it('el orden de pegado no cambia los grupos', () => {
    const r = pegar([...ORDEN].reverse())
    expect([...r.values()].map(o => o.length).sort()).toEqual([2, 3, 3])
  })
})

describe('los lugares como los escribe el detector', () => {
  it('«Bogotá (BOG)» y «Bogotá» son el mismo lugar', () => {
    expect(mismoLugar('Bogotá (BOG)', 'Bogotá')).toBe(true)
    expect(mismoLugar('San Andrés (ADZ)', 'San Andres')).toBe(true)
  })

  it('con código en los dos manda el código', () => {
    expect(mismoLugar('Bogotá (BOG)', 'El Dorado (BOG)')).toBe(true)
    expect(mismoLugar('San Andrés (ADZ)', 'Providencia (PVA)')).toBe(false)
  })

  it('sin dato no se afirma nada', () => {
    expect(mismoLugar(null, 'Bogotá')).toBeNull()
    expect(lugarComparable('  ')).toBeNull()
  })
})

describe('sin ruta ni lugar en la captura', () => {
  const hotel: RanuraCandidata = { grupo: 'hotel', tipo: 'hotel', lugar: 'Providencia', origen: null, destino: null }
  it('con una sola ranura de su tipo va con esa', () => {
    expect(ubicarCaptura({ tipo: 'hotel', lugar: null, origen: null, destino: null }, [hotel])).toEqual({ como: 'hermana', grupo: 'hotel' })
  })

  it('con dos del tipo nace una nueva', () => {
    const otro = { ...hotel, grupo: 'hotel 2', lugar: 'San Andrés' }
    expect(ubicarCaptura({ tipo: 'hotel', lugar: null, origen: null, destino: null }, [hotel, otro])).toEqual({ como: 'nueva' })
  })

  it('otro tipo nunca es hermana', () => {
    expect(ubicarCaptura({ tipo: 'traslado', lugar: 'Providencia', origen: null, destino: null }, [hotel])).toEqual({ como: 'nueva' })
  })
})

describe('el estado de los bloques', () => {
  it('«3 bloques · 2 completos · 1 requiere atención» y el motivo', () => {
    const e = [
      estadoDeBloque({ grupo: 'v1', etiqueta: 'Vuelo 1' }, [{ nombre: 'AVIANCA', conCosto: true, sinConfirmar: false, alerta: null }]),
      estadoDeBloque({ grupo: 'v2', etiqueta: 'Vuelo 2' }, [{ nombre: 'SATENA', conCosto: true, sinConfirmar: false, alerta: null }]),
      estadoDeBloque({ grupo: 'h', etiqueta: 'Hotel' }, [{ nombre: 'SIRIUS', conCosto: false, sinConfirmar: true, alerta: null }]),
    ]
    expect(resumenDeBloques(e)).toBe('3 bloques · 2 completos · 1 requiere atención')
    expect(e[2].motivo).toBe('SIRIUS: falta confirmar lo leído')
  })

  it('todos completos no dice «atención»', () => {
    const e = [estadoDeBloque({ grupo: 'v1', etiqueta: 'Vuelo 1' }, [{ nombre: 'A', conCosto: true, sinConfirmar: false, alerta: null }])]
    expect(resumenDeBloques(e)).toBe('1 bloque · 1 completo')
  })
})
