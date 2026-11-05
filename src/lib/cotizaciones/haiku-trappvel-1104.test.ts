/**
 * Prueba en pantalla con Haiku del 2026-11-04, viaje 02 de Trappvel (bitácora
 * `qa/2026-10-29_punta-a-punta-10-viajes/bitacora-prueba-haiku.md`):
 *
 *  1. La «compra antes del» de Tu Reserva («Descuento por compra anticipada válido hasta el 30/11/2026») quedó vacía:
 *     el prompt solo nombraba «Compra antes del <fecha>». Medido: 1 de 6 lecturas en main, 6 de 6 con el prompt nuevo.
 *  2. En un viaje en Bloqueo, los 4 pantallazos de paquete subidos a la bandeja general salieron «No se reconoce
 *     qué es»: la detección de la bandeja nunca preguntaba «¿hotel o vuelo del paquete?».
 *
 * El modelo es un doble: ni llaves ni red ni cuota.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PROMPT_HOTEL_BLOQUEO, PROMPT_VUELO_BLOQUEO } from './bloqueo-extraccion'
import { procesarCaptura, type CambioDeCaptura, type DependenciasDeProceso, type Deteccion } from './proceso-captura'

// La detección: lo que dice el clasificador de siempre y lo que dice con el párrafo del paquete.
const respuestas = { siempre: 'ninguno' as string, paquete: 'hotel' as string }
const llamadas: unknown[] = []
vi.mock('@/lib/ai/detectar-tipo-captura', () => ({
  detectarTipoDeCaptura: async (_b: unknown, _m: unknown, _k: unknown, opciones?: { paqueteDeBloqueo?: boolean }) => {
    llamadas.push(opciones ?? null)
    const t = opciones?.paqueteDeBloqueo ? respuestas.paquete : respuestas.siempre
    return { data: { tipo: t === 'ninguno' ? null : t, lugar: null, origen: null, destino: null } }
  },
}))

const { detectarEnLaBandeja, mensajePaqueteEnBandeja } = await import('./deteccion-bandeja')
const IMG = Buffer.from('x')

beforeEach(() => {
  llamadas.length = 0
  respuestas.siempre = 'ninguno'
  respuestas.paquete = 'hotel'
})

describe('falla 1: la «compra antes del» como la escribe cada operador', () => {
  it('el prompt del hotel nombra «válido hasta» y la compra anticipada, no solo «Compra antes del»', () => {
    expect(PROMPT_HOTEL_BLOQUEO).toMatch(/compra anticipada válido hasta el/i)
    expect(PROMPT_HOTEL_BLOQUEO).toMatch(/no es la fecha de salida/i)
  })
  it('los íconos de noches y playa no son servicios', () => {
    expect(PROMPT_HOTEL_BLOQUEO).toMatch(/noches \(cama/)
    expect(PROMPT_HOTEL_BLOQUEO).toMatch(/playa \(olas/)
  })
  it('un vuelo del itinerario del bloqueo sin escala anotada es directo', () => {
    expect(PROMPT_VUELO_BLOQUEO).toMatch(/no anota escala ni conexión[\s\S]*directo = true/)
  })
})

describe('falla 2: la bandeja general de un viaje en Bloqueo', () => {
  it('un pantallazo de paquete que la detección de siempre no reconoce va al paquete con su casilla', async () => {
    const r = await detectarEnLaBandeja(IMG, 'image/png', 'k', true)
    expect(r.casilla).toBe('hotel')
    expect(llamadas).toEqual([null, { paqueteDeBloqueo: true }])
    respuestas.paquete = 'vuelo'
    expect((await detectarEnLaBandeja(IMG, 'image/png', 'k', Promise.resolve(true))).casilla).toBe('vuelo')
  })
  it('un hotel o un vuelo que la detección de siempre sí reconoce también va al paquete, sin segunda llamada', async () => {
    respuestas.siempre = 'vuelo'
    const r = await detectarEnLaBandeja(IMG, 'image/png', 'k', true)
    expect(r.casilla).toBe('vuelo')
    expect(llamadas).toEqual([null])
  })
  it('una actividad o un traslado de un viaje en Bloqueo siguen la lectura de siempre', async () => {
    respuestas.siempre = 'traslado'
    const r = await detectarEnLaBandeja(IMG, 'image/png', 'k', true)
    expect(r.casilla).toBeNull()
    expect(r.deteccion.data?.tipo).toBe('traslado')
    expect(llamadas).toEqual([null])
  })
  it('si tampoco es hotel ni vuelo del paquete, queda «No se reconoce» como antes', async () => {
    respuestas.paquete = 'ninguno'
    const r = await detectarEnLaBandeja(IMG, 'image/png', 'k', true)
    expect(r.casilla).toBeNull()
    expect(r.deteccion.data?.tipo).toBeNull()
  })
  it('un viaje A MEDIDA no cambia: una sola llamada, sin párrafo del paquete', async () => {
    respuestas.siempre = 'hotel'
    const r = await detectarEnLaBandeja(IMG, 'image/png', 'k', false)
    expect(r.casilla).toBeNull()
    expect(r.deteccion.data?.tipo).toBe('hotel')
    respuestas.siempre = 'ninguno'
    expect((await detectarEnLaBandeja(IMG, 'image/png', 'k', false)).casilla).toBeNull()
    expect(llamadas).toEqual([null, null])
  })
  it('si no se pudo leer la modalidad, se trata como a medida', async () => {
    const r = await detectarEnLaBandeja(IMG, 'image/png', 'k', Promise.reject(new Error('red')))
    expect(r.casilla).toBeNull()
  })

  function montar(deteccion: Deteccion, alPaquete?: (c: 'hotel' | 'vuelo') => boolean) {
    const cambios: CambioDeCaptura[] = []
    const leidas: string[] = []
    const deps: DependenciasDeProceso = {
      detectar: async () => deteccion,
      leer: async tipo => { leidas.push(tipo); return { ok: false, mensaje: 'no' } },
      revisar: () => { throw new Error('no se revisa') },
      vigente: () => true,
      informar: c => cambios.push(c),
      ...(alPaquete ? { alPaquete } : {}),
    }
    return { deps, cambios, leidas }
  }
  const PAQUETE: Deteccion = { ok: false, codigo: 'PAQUETE', casilla: 'vuelo', mensaje: mensajePaqueteEnBandeja('vuelo') }

  it('la bandeja lo lleva al paquete: nada de «No se reconoce qué es» ni de lectura genérica', async () => {
    const pedidas: string[] = []
    const m = montar(PAQUETE, c => { pedidas.push(c); return true })
    await procesarCaptura(m.deps)
    expect(pedidas).toEqual(['vuelo'])
    expect(m.leidas).toEqual([])
    expect(m.cambios.some(c => c.estado?.fase === 'eligiendo_tipo')).toBe(false)
  })
  it('si la bandeja no puede llevarlo, la fila dice dónde ponerlo', async () => {
    const m = montar(PAQUETE)
    await procesarCaptura(m.deps)
    const fin = m.cambios[m.cambios.length - 1]
    expect(fin.estado).toEqual({ fase: 'rechazada', mensaje: 'Es el vuelo de un paquete de bloqueo. Ponlo en el paquete con «+ Paquete».' })
    expect(m.leidas).toEqual([])
  })
})
