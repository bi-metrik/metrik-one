/**
 * R8 · el bloque de una opción de hotel con varias habitaciones, con el caso real
 * COT-2026-0013 (copiado en el fixture, no leído de la base).
 *
 * Lo que se fija (regla 5 del diseño):
 *  1. Los cupos del grupo en una línea: «6/6 adultos · 1/1 niño · 1/1 infante».
 *  2. Lo que falta, cuando falta, a la vista.
 *  3. Cada captura dice «Habitación N» o «Solo para restar»; el papel ya no se cambia en pantalla.
 *  4. Sin par para restar, el costo va por habitación (regla 8).
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import fixture from '@/lib/cotizaciones/__fixtures__/cot-2026-0013-hoteles.fixture.json'
import { tarifaConHabitaciones } from '@/lib/cotizaciones/habitaciones'
import type { Habitacion, LecturaCasilla, TarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'

vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {}, warning: () => {} } }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({
  leerCasillaDeItem: async () => ({ ok: true, mensaje: '', alertas: [] }),
  confirmarTarifaPorPasajero: async () => ({ success: true }),
  cambiarRolHabitacion: async () => ({ success: true }),
  quitarHabitacion: async () => ({ success: true }),
}))

const { default: HabitacionesDeOpcion } = await import('./habitaciones-opcion')

const GRUPO = fixture.grupo
const lectura = (id: string) => fixture.hoteles.find(h => h.item === id)!.lectura as unknown as LecturaCasilla
const habs = (ids: string[]): Habitacion[] => ids.map(id => ({ id, lectura: lectura(id) }))

function pintar(tarifa: TarifaPax) {
  return renderToStaticMarkup(React.createElement(HabitacionesDeOpcion, {
    itemId: 'item-1',
    tarifa,
    composicionViaje: GRUPO,
    monedaSlot: null,
    onGuardada: () => {},
    onCambio: () => {},
  }))
}

describe('R8 · el bloque de habitaciones de COT-2026-0013', () => {
  it('Posada Enilda: cupos completos, tres habitaciones numeradas y el costo por habitación', () => {
    const html = pintar(tarifaConHabitaciones({}, habs(['2164b941', '68d431db', '7944d5cc']), GRUPO))
    expect(html).toContain('6/6 adultos · 1/1 niño · 1/1 infante')
    expect(html).not.toContain('data-faltantes')
    for (const n of [1, 2, 3]) expect(html).toContain(`Habitación ${n}`)
    expect(html).not.toContain('Solo para restar')
    // El botón de cambiar el papel salió de la pantalla (tarjeta del 2026-09-24).
    expect(html).not.toContain('Usar solo para restar')
    // Regla 8: sin par del mismo tipo, cada habitación con su precio.
    expect(html).toContain('el precio va por habitación')
    expect(html).toContain('Confirmar y cargar el costo')
    expect(html).toContain('Pega otra habitación de este hotel')
  })

  it('Agua Dulce tal como está guardada: dice lo que falta y lo que sobra', () => {
    const html = pintar(tarifaConHabitaciones({}, habs(['efb0a3c3', 'f9fbc4d5', '5542356a']), GRUPO))
    expect(html).toContain('6/6 adultos · 2/1 niños · 0/1 infante')
    expect(html).toContain('Falta cotizar 1 infante. Sobra 1 niño.')
  })

  it('una captura fijada a mano como «solo para restar» lo dice, sin botones para cambiar el papel', () => {
    const conManual = habs(['2164b941', '68d431db', '7944d5cc'])
    conManual[0] = { ...conManual[0], rolManual: { valor: 'referencia', por: 'Alejandra', porId: 'u', en: '2026-09-24T00:00:00Z' } }
    const html = pintar(tarifaConHabitaciones({}, conManual, GRUPO))
    expect(html).toContain('Solo para restar')
    expect(html).toContain('(fijado a mano)')
    expect(html).not.toContain('Que lo decida el reparto')
    expect(html).not.toContain('Usar como habitación')
    // Sin esa habitación faltan dos adultos: se dice.
    expect(html).toContain('Falta cotizar 2 adultos')
  })
})
