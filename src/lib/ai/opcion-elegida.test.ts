/**
 * P8 del ensayo del 2026-09-23 (caso Providencia): el hotel con grilla de habitaciones se
 * rechazaba aunque una fila estuviera marcada «✓ Seleccionada».
 *
 * Las opciones de estas pruebas son las que el lector real vio en la versión CON GRILLA de la
 * captura del Deep Blue (`qa/2026-09-23_caso-providencia/png/06b-hotel-providencia-deep-blue-grilla.png`,
 * armada desde `capturas.html` sin el `.filter(r=>r[4])`), grabadas de la corrida del mismo día.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { construirPrompt, extraerRanuraDesdeImagen, normalizarRespuesta, opcionMarcada } from './extraer-ranura'
import { evaluarLectura, opcionesParaElegir, type LecturaCruda } from '@/lib/cotizaciones/lectura-pantallazo'
import { ranuraPorSlug } from '@/lib/cotizaciones/ranuras-pantallazo'

const HOTEL = ranuraPorSlug('hotel_detalle')!

/** Lo que el lector vio en la grilla del Deep Blue. */
const GRILLA_DEEP_BLUE = [
  { nombre: 'Habitación Garden View · Solo alojamiento', precio: '5.910.300 COP', seleccionada: false },
  { nombre: 'Suite Ocean View · Alojamiento y desayuno', precio: '6.842.000,00 COP', seleccionada: true },
  { nombre: 'Suite Ocean View · Media pensión', precio: '8.106.400 COP', seleccionada: false },
]

function lectura(over: Partial<LecturaCruda>): LecturaCruda {
  return { veredicto: 'varias_opciones', observacion: null, campos: {}, desglose: [], opcionesVisibles: 3, ...over }
}

describe('P8 · una fila marcada como elegida no se rechaza: se lee esa', () => {
  it('con UNA fila marcada, esa es la opción a leer', () => {
    expect(opcionMarcada(lectura({ opcionesVistas: GRILLA_DEEP_BLUE })))
      .toEqual({ nombre: 'Suite Ocean View · Alojamiento y desayuno', precio: '6.842.000,00 COP' })
  })

  it('sin marca, o con dos, no hay elección que tomar', () => {
    const sinMarca = GRILLA_DEEP_BLUE.map(o => ({ ...o, seleccionada: false }))
    expect(opcionMarcada(lectura({ opcionesVistas: sinMarca }))).toBeNull()
    const dos = GRILLA_DEEP_BLUE.map((o, i) => ({ ...o, seleccionada: i > 0 }))
    expect(opcionMarcada(lectura({ opcionesVistas: dos }))).toBeNull()
  })

  it('una lectura que no se rechazó no se toca', () => {
    expect(opcionMarcada(lectura({ veredicto: 'detalle_unico', opcionesVisibles: 1, opcionesVistas: GRILLA_DEEP_BLUE }))).toBeNull()
  })

  it('el modelo dice qué fila está marcada; se normaliza sin inventar marcas', () => {
    const cruda = normalizarRespuesta({
      veredicto: 'varias_opciones',
      opciones_vistas: [{ nombre: 'A', precio: '1', seleccionada: true }, { nombre: 'B', precio: '2' }, { nombre: '', precio: '3' }],
      campos: {}, desglose: [], por_tipo_pax: [],
    })
    expect(cruda.opcionesVistas).toEqual([
      { nombre: 'A', precio: '1', seleccionada: true },
      { nombre: 'B', precio: '2', seleccionada: false },
    ])
  })

  afterEach(() => vi.unstubAllGlobals())

  it('la lectura se repite SOBRE la fila marcada, y esa segunda es la que queda', async () => {
    const cuerpos: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      const modelo = /models\/([^:]+):/.exec(url)?.[1] ?? ''
      // La detección de estrellas no importa aquí.
      if (modelo === 'gemini-3.5-flash') {
        return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '[]' }] } }] }))
      }
      cuerpos.push(init.body)
      const enfocada = init.body.includes('OPCION YA ELEGIDA')
      const texto = JSON.stringify(enfocada
        ? { opciones_vistas: GRILLA_DEEP_BLUE, veredicto: 'detalle_unico', campos: { regimen: { value: 'Alojamiento y desayuno', confidence: 1 } }, desglose: [], por_tipo_pax: [] }
        : { opciones_vistas: GRILLA_DEEP_BLUE, veredicto: 'varias_opciones', campos: {}, desglose: [], por_tipo_pax: [] })
      return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: texto }] } }] }))
    }))
    const r = await extraerRanuraDesdeImagen(Buffer.from('x'), 'image/png', HOTEL, 'k')
    expect(cuerpos).toHaveLength(2)
    expect(cuerpos[1]).toContain('Suite Ocean View · Alojamiento y desayuno')
    expect(r.data?.veredicto).toBe('detalle_unico')
    expect(r.data?.elegida).toMatchObject({ por: 'marcada', nombre: 'Suite Ocean View · Alojamiento y desayuno' })
    expect(r.data?.campos.regimen?.value).toBe('Alojamiento y desayuno')
  })
})

describe('P8 · ambigua de verdad: «¿Cuál de estas?», no un rechazo seco', () => {
  it('el rechazo trae las opciones leídas para que la persona toque una', () => {
    const r = evaluarLectura(HOTEL, lectura({ opcionesVistas: GRILLA_DEEP_BLUE.map(o => ({ ...o, seleccionada: false })) }))
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.codigo).toBe('RX1')
    expect(r.opciones?.map(o => o.precio)).toEqual(['5.910.300 COP', '6.842.000,00 COP', '8.106.400 COP'])
  })

  it('con menos de dos opciones legibles no hay de dónde elegir', () => {
    expect(opcionesParaElegir([{ nombre: 'Solo una', precio: '1', seleccionada: false }])).toEqual([])
    expect(opcionesParaElegir([
      { nombre: 'A', precio: '1', seleccionada: false },
      { nombre: 'a', precio: '1', seleccionada: false },
    ])).toEqual([])
  })

  it('una lectura hecha sobre la opción elegida NO se contradice por ver las demás', () => {
    const elegida = lectura({
      veredicto: 'detalle_unico',
      opcionesVisibles: 3,
      elegida: { nombre: 'Suite Ocean View · Media pensión', precio: '8.106.400 COP', por: 'persona' },
    })
    const r = evaluarLectura(HOTEL, elegida)
    // Puede fallar por campos mínimos (esta lectura no los trae), pero NO por RX1.
    if (!r.ok) expect(r.codigo).not.toBe('RX1')
    // Sin la elección, la misma lectura sí se contradice.
    const sin = evaluarLectura(HOTEL, { ...elegida, elegida: null })
    expect(sin.ok).toBe(false)
    if (!sin.ok) expect(sin.codigo).toBe('RX1')
  })

  it('el prompt con la opción elegida la nombra ANTES de la regla de no elegir', () => {
    const p = construirPrompt(HOTEL, { nombre: 'Suite Ocean View · Media pensión', precio: '8.106.400 COP' })
    expect(p.indexOf('OPCION YA ELEGIDA')).toBeGreaterThan(-1)
    expect(p.indexOf('OPCION YA ELEGIDA')).toBeLessThan(p.indexOf('REGLA ABSOLUTA'))
    // Sin elección, el prompt no la menciona.
    expect(construirPrompt(HOTEL)).not.toContain('OPCION YA ELEGIDA')
  })
})
