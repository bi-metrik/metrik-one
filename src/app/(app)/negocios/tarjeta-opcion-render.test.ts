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
import { hotelesDeItems } from '@/lib/cotizaciones/detalle-viaje'
import { textosDeTarjetaHotel } from '@/lib/pdf/cotizacion-trappvel-formato'
import type { Habitacion, LecturaCasilla, TarifaConfirmada, TarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'

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
    bloqueTitulo: 'Hotel en Providencia',
    onGuardarNota: () => {},
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

describe('costo y precio: las alertas del prototipo', () => {
  const CONFIRMADA = {
    composicion: GRUPO,
    costos: [
      { tipo: 'adulto', cantidad: 6, unitarioCOP: 634000, totalCOP: 3804000 },
      { tipo: 'nino', cantidad: 1, unitarioCOP: 151400, totalCOP: 151400 },
      { tipo: 'infante', cantidad: 1, unitarioCOP: 22000, totalCOP: 22000 },
    ],
    costoTotalCOP: 3977400, moneda: 'COP', tasa: null, confirmadaEn: '2026-09-24T00:00:00Z',
  } as unknown as TarifaConfirmada

  it('un precio a mano bajo el costo: «a mano», ⚠ en la fila y ⚠ del margen aunque sea negativo', () => {
    const tarifa = {
      ...tarifaConHabitaciones({}, habs(POSADA), GRUPO),
      preciosAMano: { adulto: { precio: 600000, por: 'Alejandra', porId: 'p1', en: '2026-09-24T00:00:00Z' } },
    }
    // Lo que calcula el servidor: 6 × 600.000 + (151.400 + 22.000) / 0,85.
    const html = pintar(tarifa, { confirmada: CONFIRMADA, precioLinea: 3804000, precioOpcion: 3804000, costoLinea: 3977400 })
    const t = texto(html)
    expect(t).toContain('a mano')
    expect(t).toContain('Este precio queda por debajo del costo')
    expect(t).toContain('Con este margen necesitas autorización para enviar')
    expect(t).toMatch(/Margen -4,6 %/)
  })

  it('con el margen sobre el piso no hay ⚠', () => {
    const html = pintar(tarifaConHabitaciones({}, habs(POSADA), GRUPO), { confirmada: CONFIRMADA, precioLinea: 4679294, costoLinea: 3977400 })
    expect(texto(html)).not.toContain('Con este margen necesitas autorización para enviar')
    expect(texto(html)).toMatch(/Margen 15 %/)
  })
})

describe('así lo ve el cliente', () => {
  const tarifa = () => tarifaConHabitaciones({}, habs(POSADA), GRUPO)

  it('va después de «Costo y precio», con el bloque en magenta, «OPCIÓN N» y la inversión', () => {
    const html = pintar(tarifa())
    expect(html.indexOf('data-hoja-cliente')).toBeGreaterThan(html.indexOf('aria-label="Costo y precio"'))
    const t = texto(html)
    expect(t).toContain('HOTEL EN PROVIDENCIA')
    expect(t).toContain('OPCIÓN 2')
    expect(t).toContain('INVERSIÓN')
    expect(t).toContain('Así sale esta opción en la cotización que recibe el cliente.')
    expect(t).toContain('Agrega una nota para el cliente…')
  })

  it('los textos de la hoja son los del PDF (`textosDeTarjetaHotel`), no una copia', () => {
    const t = tarifa()
    const doc = textosDeTarjetaHotel(hotelesDeItems([{ nombre: 'POSADA ENILDA', grupo: 'hotel', tarifa_pax: t, adicionales: [] }])[0], false)
    const html = pintar(t)
    expect(doc.resumen).not.toBe('')
    expect(html).toContain(`>${doc.resumen}<`)
    if (doc.condiciones) expect(html).toContain(`>${doc.condiciones}<`)
  })

  it('en el nivel «general» la hoja no nombra habitación ni régimen, igual que el PDF', () => {
    const t = tarifa()
    const doc = textosDeTarjetaHotel(hotelesDeItems([{ nombre: 'POSADA ENILDA', grupo: 'hotel', tarifa_pax: t, adicionales: [] }])[0], true)
    const html = pintar(t, { general: true })
    expect(html).toContain(`>${doc.resumen}<`)
    expect(html).not.toContain('Acomodación:')
  })

  it('la nota escrita por una persona se imprime en la hoja y se edita tocándola', () => {
    const html = pintar(tarifa(), { item: { nombre: 'POSADA ENILDA', grupo: 'hotel', tarifa_pax: tarifa(), descripcion: 'INCLUYE TRASLADO' } })
    expect(html).toContain('aria-label="Editar la nota para el cliente"')
    expect(texto(html)).toContain('INCLUYE TRASLADO')
  })

  it('un vuelo no tiene hoja: su nota sigue donde estaba', () => {
    const html = pintar(tarifa(), { item: { nombre: 'AVIANCA', grupo: 'vuelo', tarifa_pax: tarifa() }, nota: 'NOTA-DE-VUELO' })
    expect(html).not.toContain('data-hoja-cliente')
    expect(html).toContain('NOTA-DE-VUELO')
  })
})

describe('la captura que solo sirve para restar', () => {
  it('no lleva título propio: la explica «ONE la usa para sacar el precio…»', () => {
    const extra: Habitacion = { id: 'extra', lectura: { ...lectura('7944d5cc'), imagenRef: null } as unknown as LecturaCasilla }
    const html = pintar(tarifaConHabitaciones({}, [...habs(POSADA), extra], GRUPO))
    expect(texto(html)).not.toContain('Solo para restar')
    expect(html).toContain('data-habitacion="extra"')
  })
})
