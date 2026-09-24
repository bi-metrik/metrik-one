/**
 * La tarjeta de una opción de hotel (prototipo aprobado por Mauricio el 2026-09-24), con las
 * habitaciones reales de COT-2026-0013 (copiadas en el fixture, no leídas de la base).
 *
 * Lo que se fija:
 *  1. El orden del prototipo: cabecera, ficha, alojamiento, costo y precio.
 *  2. El alojamiento: el resumen, los cupos, una fila por habitación con su pantallazo y su ⋯.
 *  3. Si falta alguien, la caja ámbar que pide su habitación, con su zona de pegado.
 *  4. El ⚠ de un pantallazo de este hotel que espera en la bandeja, con «Ir a la bandeja».
 *  5. La tabla con los rótulos del prototipo.
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import fixture from '@/lib/cotizaciones/__fixtures__/cot-2026-0013-hoteles.fixture.json'
import { tarifaConHabitaciones } from '@/lib/cotizaciones/habitaciones'
import type { Habitacion, LecturaCasilla, TarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { success: () => {}, error: () => {}, warning: () => {} }) }))
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({}))
vi.mock('@/app/(app)/negocios/adicional-actions', () => ({}))

const { default: TarjetaOpcion } = await import('./tarjeta-opcion')

const GRUPO = fixture.grupo
const lectura = (id: string) => fixture.hoteles.find(h => h.item === id)!.lectura as unknown as LecturaCasilla
const habs = (ids: string[]): Habitacion[] => ids.map(id => ({ id, lectura: { ...lectura(id), imagenRef: `sbext://capturas/${id}.png` } }))

function pintar(tarifa: TarifaPax, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(React.createElement(TarjetaOpcion, {
    itemId: 'item-1',
    numero: 2,
    item: { nombre: 'POSADA ENILDA', grupo: 'hotel', tarifa_pax: tarifa },
    tarifa,
    composicionViaje: GRUPO,
    editable: true,
    abierta: true,
    onAlternar: () => {},
    precioOpcion: 1_500_000,
    precioLinea: 1_500_000,
    costoLinea: 1_215_200,
    confirmada: null,
    margenAplicado: 15,
    convencion: 'sobre_venta',
    administrativosPct: 0,
    pisoPct: 5,
    adicionales: [],
    adicionalesDisponible: true,
    margenCotizacion: { margenPct: 15, convencion: 'sobre_venta' },
    pendiente: null,
    onIrABandeja: () => {},
    onEliminar: () => {},
    onMover: () => {},
    mover: null,
    respaldo: null,
    nota: null,
    onCambio: () => {},
    ...extra,
  }))
}

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const POSADA = ['2164b941', '68d431db', '7944d5cc']

describe('la tarjeta de una opción de hotel', () => {
  it('en el orden del prototipo: cabecera, ficha, alojamiento, costo y precio', () => {
    const html = pintar(tarifaConHabitaciones({}, habs(POSADA), GRUPO))
    const pos = ['>Opción 2<', 'data-ficha', 'aria-label="Alojamiento"', 'aria-label="Costo y precio"'].map(m => html.indexOf(m))
    expect(pos.every(p => p > 0)).toBe(true)
    expect([...pos].sort((a, b) => a - b)).toEqual(pos)
    expect(texto(html)).toContain('Precio $1.500.000')
  })

  it('el alojamiento dice cuántas habitaciones, a quién cubren, y cada una trae su pantallazo', () => {
    const html = pintar(tarifaConHabitaciones({}, habs(POSADA), GRUPO))
    const t = texto(html)
    expect(t).toContain('3 habitaciones · cubre a los 8 viajeros')
    expect(t).toContain('6/6 adultos · 1/1 niño · 1/1 infante')
    for (const n of [1, 2, 3]) expect(t).toContain(`Habitación ${n}`)
    expect(html).toContain('/api/archivos/abrir?ref=sbext%3A%2F%2Fcapturas%2F2164b941.png')
    expect(html).not.toContain('data-pide-habitacion')
    expect(html).not.toContain('Usar solo para restar')
  })

  it('si falta alguien, la caja ámbar pide su habitación con una zona de pegado', () => {
    const html = pintar(tarifaConHabitaciones({}, habs(POSADA.slice(0, 2)), GRUPO))
    const t = texto(html)
    expect(t).toMatch(/Faltan? .+: pega su habitación\./)
    expect(t).toContain('Pega aquí el pantallazo o arrástralo')
    expect(t).toContain('ONE lo suma a esta opción.')
    expect(html).toContain('data-pide-habitacion')
  })

  it('sin editar no se pide la habitación ni hay menús', () => {
    const html = pintar(tarifaConHabitaciones({}, habs(POSADA.slice(0, 2)), GRUPO), { editable: false })
    expect(html).not.toContain('data-pide-habitacion')
    expect(html).not.toContain('aria-label="Más acciones"')
  })

  it('un pantallazo de este hotel en la bandeja se avisa con el ⚠ y no con una franja', () => {
    const sin = pintar(tarifaConHabitaciones({}, habs(POSADA), GRUPO))
    expect(sin).not.toContain('data-alerta-decision')
    const con = pintar(tarifaConHabitaciones({}, habs(POSADA), GRUPO), { pendiente: { capturaId: 'cap-1' } })
    expect(con).toContain('Hay un pantallazo de este hotel esperando tu decisión')
    expect(con.indexOf('data-alerta-decision')).toBeLessThan(con.indexOf('data-ficha'))
  })

  it('la tabla lleva los rótulos del prototipo', () => {
    const t = texto(pintar(tarifaConHabitaciones({}, habs(POSADA), GRUPO)))
    expect(t).toContain('Pasajero Cant. Costo c/u Precio c/u Precio total')
    expect(t).toContain('+ Adicional')
  })

  it('cerrada, la fila dice la habitación, cuántas y si cubre al grupo', () => {
    const html = pintar(tarifaConHabitaciones({}, habs(POSADA.slice(0, 2)), GRUPO), { abierta: false })
    expect(html).not.toContain('data-opcion-abierta')
    expect(texto(html)).toMatch(/2 habitaciones · faltan? /)
  })
})
