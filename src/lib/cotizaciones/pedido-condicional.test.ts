/**
 * S-07 del QA Trappvel del 2026-10-29 (ronda 3, grupo G13): Universal entró «Incluido» aunque el
 * cliente dijo «si alcanza la plata», y sumó $3,5 M que no pidió en firme. Lo pedido con condición
 * llega Opcional en la bandeja (no suma; se ofrece aparte con su precio).
 */
import { describe, expect, it } from 'vitest'

import { estadoInicial } from './bandeja-por-pasos'
import { pedidoCondicional } from './pedido-condicional'
import type { Borrador } from './proceso-captura'
import type { LecturaCasilla } from './tarifa-pasajero'

/** Los requisitos de la Solicitud del viaje 07, como los guardó DA1 (copia literal, en mayúsculas). */
const REQUISITOS_07 = 'DISNEY 4 DÍAS SEGURO. UNIVERSAL UN DÍA SI ALCANZA LA PLATA. Y SÍ, CARRO, UNA CAMIONETA PARA LAS MALETAS, LO DEJAMOS EN MIAMI. EN ORLANDO QUE EL HOTEL TENGA PISCINA PARA LOS NIÑOS'

const actividad = (nombre: string): Borrador => {
  const lectura = {
    nombre,
    moneda: 'USD',
    total: 846,
    campos: [
      { label: 'Proveedor', valor: 'ParkPass' },
      { label: 'Actividad', valor: nombre },
      { label: 'Ciudad', valor: 'Orlando' },
    ],
  } as unknown as LecturaCasilla
  return { tipo: 'actividad', lectura, lecturaJson: JSON.stringify(lectura), firma: 'f', pistas: null } as unknown as Borrador
}
const NUEVA = { como: 'nueva' } as Parameters<typeof estadoInicial>[1]

describe('S-07 · lo que el cliente pidió con condición', () => {
  it('encuentra la frase condicional que nombra la actividad', () => {
    expect(pedidoCondicional(REQUISITOS_07, 'Universal Orlando: 1 día Park-to-Park (2 parques)')).toBe('UNIVERSAL UN DÍA SI ALCANZA LA PLATA')
    expect(pedidoCondicional('Un tour a Isla Saona, si nos da el presupuesto', 'Excursión Isla Saona día completo')).toMatch(/si nos da el presupuesto/)
  })

  it('lo pedido en firme, o una frase condicional de otra cosa, no cuenta', () => {
    expect(pedidoCondicional(REQUISITOS_07, 'Walt Disney World: entrada base de 4 días')).toBeNull()
    expect(pedidoCondicional(REQUISITOS_07, 'Tour por el parque')).toBeNull()
    expect(pedidoCondicional(null, 'Universal Orlando')).toBeNull()
  })

  it('en la bandeja: Universal llega Opcional y dice por qué; Disney llega Incluido', () => {
    expect(estadoInicial(actividad('Universal Orlando: 1 día Park-to-Park (2 parques)'), NUEVA, REQUISITOS_07)).toEqual({
      estado: 'opcional',
      motivo: 'UNIVERSAL UN DÍA SI ALCANZA LA PLATA',
      delCliente: true,
    })
    expect(estadoInicial(actividad('Walt Disney World: entrada base de 4 días'), NUEVA, REQUISITOS_07)).toEqual({ estado: 'incluido', motivo: null })
  })
})
