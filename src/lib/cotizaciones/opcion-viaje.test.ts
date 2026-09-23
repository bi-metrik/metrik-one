/**
 * La ficha, la fila contraída y el orden de los bloques del editor de Trappvel (P2 y P6 del
 * ensayo del 2026-09-23), con la lectura REAL de las capturas del caso Providencia
 * (`providencia-equipaje.fixture.json`).
 */
import { describe, expect, it } from 'vitest'

import fixture from './providencia-equipaje.fixture.json'
import {
  codigoDeLugar,
  equipajeCorto,
  fichaDeOpcion,
  notaDeLaLinea,
  ordenarComoElViaje,
  resumenDeOpcion,
  tituloDeBloque,
} from './opcion-viaje'
import { ranuraPorSlug } from './ranuras-pantallazo'
import type { TipoRanura } from './ranuras-cotizacion'

const LECTURAS = fixture as unknown as Record<string, Record<string, string | null>>
const VUELO = ranuraPorSlug('vuelo_detalle')!

/** Una opción con su pantallazo leído, como la guarda `leerCasillaDeItem`. */
function opcion(archivo: string, grupo: string, extra: Record<string, unknown> = {}) {
  const valores = LECTURAS[archivo]
  const campos = VUELO.campos
    .filter(c => valores[c.slug] !== null && valores[c.slug] !== undefined)
    .map(c => ({ label: c.label, valor: valores[c.slug] as string }))
  return {
    nombre: archivo,
    grupo,
    descripcion: null as string | null,
    tarifa_pax: { casillas: { grupo_completo: { moneda: 'COP', total: 1, campos } }, ...extra },
  }
}

const AVIANCA = opcion('01-vuelo1-bog-adz-avianca.png', 'vuelo')
const WINGO = opcion('03-vuelo1-bog-adz-wingo.png', 'vuelo')
const PAX = { adultos: 2, ninos: 0, infantes: 1 }

describe('P2 · la ficha de lo que va a la cotización', () => {
  it('el vuelo de Avianca, en texto y sin campos', () => {
    expect(fichaDeOpcion(AVIANCA, PAX)).toEqual([
      'Avianca · AV8520 / AV8527 · Tarifa Classic',
      'Ida lun 9 nov · BOG 06:05 → ADZ 08:20 · directo',
      'Regreso vie 13 nov · ADZ 17:40 → BOG 19:55 · directo',
      'Equipaje: personal, mano 10 kg, bodega 23 kg',
      '2 adultos, 1 infante',
    ])
  })

  it('Wingo dice lo que NO lleva', () => {
    expect(fichaDeOpcion(WINGO, PAX)).toContain('Equipaje: personal (sin mano ni bodega)')
  })

  it('sin lectura no hay ficha', () => {
    expect(fichaDeOpcion({ nombre: 'VUELO', grupo: 'vuelo' }, PAX)).toEqual([])
  })
})

describe('P6 · la fila contraída muestra lo que sirve para comparar', () => {
  it('número, horas y bodega; sin el texto largo', () => {
    expect(resumenDeOpcion(AVIANCA)).toBe('AV8520 · ida 06:05 → 08:20 · regreso 17:40 · bodega 23 kg')
    expect(resumenDeOpcion(WINGO)).toBe('P57302 · ida 11:20 → 13:40 · regreso 14:35 · sin bodega')
  })
})

describe('P6 · los bloques como el viaje, y los vuelos numerados con su ruta', () => {
  const bloque = (grupo: string | null, tipo: TipoRanura | null, lineas: ReturnType<typeof opcion>[], etiqueta: string | null = grupo) =>
    ({ grupo, tipo, lineas, etiqueta })

  it('vuelos por la fecha y hora de su ida, después hotel, traslados, actividades y lo suelto', () => {
    const segundo = opcion('01-vuelo1-bog-adz-avianca.png', 'vuelo 2', {})
    // El «vuelo 2» sale un día después: se le corre la fecha en la lectura.
    const campos = (segundo.tarifa_pax.casillas.grupo_completo.campos as { label: string; valor: string }[])
    for (const c of campos) if (c.label === 'Salida') c.valor = '2026-11-10'
    const orden = ordenarComoElViaje([
      bloque(null, null, []),
      bloque('actividad', 'actividad', []),
      bloque('vuelo 2', 'vuelo', [segundo]),
      bloque('hotel', 'hotel', []),
      bloque('vuelo', 'vuelo', [AVIANCA, WINGO]),
      bloque('traslado', 'traslado', []),
    ])
    expect(orden.map(b => b.grupo)).toEqual(['vuelo', 'vuelo 2', 'hotel', 'traslado', 'actividad', null])
  })

  it('«Vuelo 1 · BOG → ADZ», con el nombre largo como subtítulo', () => {
    expect(tituloDeBloque(bloque('vuelo', 'vuelo', [AVIANCA], 'Vuelo Bogotá–San Andrés'), 1))
      .toEqual({ titulo: 'Vuelo 1 · BOG → ADZ', subtitulo: 'Vuelo Bogotá–San Andrés' })
    expect(tituloDeBloque(bloque('hotel', 'hotel', [], 'Hotel en Providencia'), null))
      .toEqual({ titulo: 'Hotel en Providencia', subtitulo: null })
  })

  it('el código sale del lugar leído', () => {
    expect(codigoDeLugar('Bogotá (BOG)')).toBe('BOG')
    expect(codigoDeLugar('ADZ')).toBe('ADZ')
  })
})

describe('P2 · la nota para el cliente es lo que escribió una persona', () => {
  it('la descripción que armó ONE no es nota: se rearma de los campos', () => {
    const conSistema = { ...AVIANCA, descripcion: 'IDA AV 8520', tarifa_pax: { ...AVIANCA.tarifa_pax, descripcionDelSistema: 'IDA AV 8520' } }
    expect(notaDeLaLinea(conSistema)).toBeNull()
  })

  it('una descripción escrita a mano se conserva como nota', () => {
    const aMano = { ...AVIANCA, descripcion: 'Silla junto a la ventana', tarifa_pax: { ...AVIANCA.tarifa_pax, descripcionDelSistema: 'IDA AV 8520' } }
    expect(notaDeLaLinea(aMano)).toBe('Silla junto a la ventana')
  })

  it('en una línea sin pantallazo, lo que haya lo escribió alguien', () => {
    expect(notaDeLaLinea({ descripcion: 'Seguro de viaje con asistencia', tarifa_pax: null })).toBe('Seguro de viaje con asistencia')
  })

  it('el equipaje corto sin nada leído es null', () => {
    expect(equipajeCorto({ personal: null, mano: null, bodega: null })).toBeNull()
  })
})
