/** P10 del caso Providencia: el pantallazo repetido en la bandeja (Mauricio, 2026-09-23). */
import { describe, expect, it } from 'vitest'

import {
  compararConExistentes,
  huellaDeImagen,
  mensajeMismaImagen,
  mismoServicio,
  opcionConLaMismaImagen,
  type OpcionComparable,
} from './captura-repetida'

function vuelo(id: string, o: {
  aerolinea?: string | null
  fecha?: string
  total?: number
  moneda?: string
  numero?: string
  huella?: string
  grupo?: string
} = {}): OpcionComparable {
  const campos = o.numero ? [{ label: 'Nº de vuelo', valor: o.numero }] : []
  return {
    id,
    nombre: 'OPCIÓN 1',
    grupo: o.grupo ?? 'vuelo',
    tarifa_pax: {
      casillas: {
        grupo_completo: {
          moneda: o.moneda ?? 'COP',
          total: o.total ?? 1_250_000,
          identidad: {
            aerolinea: o.aerolinea === undefined ? 'Satena' : o.aerolinea,
            origen: 'ADZ',
            destino: 'PVA',
            fecha_salida: o.fecha ?? '2026-10-12',
            fecha_regreso: null,
          },
          campos,
          ...(o.huella ? { huellaImagen: o.huella } : {}),
        },
      },
    },
  }
}

function hotel(id: string, nombre: string, total = 900_000): OpcionComparable {
  return {
    id,
    grupo: 'hotel',
    tarifa_pax: {
      casillas: {
        grupo_completo: {
          moneda: 'COP', total,
          identidad: { hotel: nombre, tipo_habitacion: 'Doble', regimen: null, check_in: '2026-10-12', check_out: '2026-10-15' },
          campos: [],
        },
      },
    },
  }
}

describe('misma imagen (huella del archivo)', () => {
  it('la misma imagen da la misma huella; otra imagen, otra', async () => {
    const a = await huellaDeImagen('data:image/png;base64,AAAA')
    const b = await huellaDeImagen('data:image/png;base64,AAAA')
    const c = await huellaDeImagen('data:image/png;base64,AAAB')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
    expect(c).not.toBe(a)
  })

  it('un texto que no es una imagen no tiene huella: se procesa como siempre', async () => {
    expect(await huellaDeImagen('hola')).toBeNull()
  })

  it('encuentra la opción que se leyó de esa imagen, en cualquier casilla', () => {
    const opciones = [vuelo('a'), vuelo('b', { huella: 'h-1' })]
    expect(opcionConLaMismaImagen('h-1', opciones)?.id).toBe('b')
    expect(opcionConLaMismaImagen('h-2', opciones)).toBeNull()
    expect(opcionConLaMismaImagen(null, opciones)).toBeNull()
  })

  it('la fila nombra dónde está ya', () => {
    const ub = { b: { bloque: 'Vuelo 1 · ADZ → PVA', opcion: 2 } }
    expect(mensajeMismaImagen('b', ub)).toBe('Ya está como Opción 2 de Vuelo 1 · ADZ → PVA')
    expect(mensajeMismaImagen(null, ub, 'Vuelo a Providencia')).toBe('Es la misma imagen que ya pegaste para Vuelo a Providencia')
    expect(mensajeMismaImagen(null, ub)).toBe('Es la misma imagen que ya pegaste en esta bandeja')
  })
})

describe('mismo contenido, otra imagen', () => {
  it('mismo servicio y mismo precio: parece igual', () => {
    const r = compararConExistentes(vuelo('nueva'), [vuelo('vieja')])
    expect(r).toEqual({ tipo: 'parecida', con: expect.objectContaining({ id: 'vieja' }) })
  })

  it('la aerolínea se compara sin tildes ni mayúsculas', () => {
    expect(mismoServicio(vuelo('a', { aerolinea: 'SATENA' }), vuelo('b', { aerolinea: 'satena' }))).toBe(true)
  })

  it('otra aerolínea u otras fechas no es el mismo servicio', () => {
    expect(compararConExistentes(vuelo('n', { aerolinea: 'Avianca' }), [vuelo('v')])).toBeNull()
    expect(compararConExistentes(vuelo('n', { fecha: '2026-10-13' }), [vuelo('v')])).toBeNull()
  })

  it('otro número de vuelo no es el mismo servicio, aunque la aerolínea coincida', () => {
    expect(mismoServicio(vuelo('a', { numero: 'NR 8520' }), vuelo('b', { numero: 'NR8522' }))).toBe(false)
    expect(mismoServicio(vuelo('a', { numero: 'NR 8520' }), vuelo('b', { numero: 'nr8520' }))).toBe(true)
  })

  it('sin la aerolínea en alguna de las dos no se afirma nada', () => {
    expect(compararConExistentes(vuelo('n', { aerolinea: null }), [vuelo('v')])).toBeNull()
  })

  it('un hotel no se parece a un vuelo, y dos hoteles distintos tampoco', () => {
    expect(compararConExistentes(hotel('n', 'Deep Blue'), [vuelo('v')])).toBeNull()
    expect(compararConExistentes(hotel('n', 'Deep Blue'), [hotel('v', 'Sirius')])).toBeNull()
  })

  it('R8 · regla 6: dos capturas iguales de hotel son dos habitaciones, no una repetida', () => {
    // Un grupo de 4 adultos son dos dobles iguales. Lo repetido de un hotel lo deciden la misma
    // imagen o los cupos del grupo ya cubiertos, en el servidor (`unirHotelComoHabitacion`).
    expect(compararConExistentes(hotel('n', 'Deep Blue'), [hotel('v', 'Deep Blue')])).toBeNull()
    expect(compararConExistentes(hotel('n', 'Deep Blue', 1), [hotel('v', 'Deep Blue', 2)])).toBeNull()
  })

  it('R8 · la misma imagen se reconoce también entre las habitaciones de una opción', () => {
    const conHabitaciones: OpcionComparable = {
      id: 'h',
      grupo: 'hotel',
      tarifa_pax: {
        casillas: { grupo_completo: { moneda: 'COP', total: 1, identidad: {}, campos: [], huellaImagen: 'h-1' } },
        habitaciones: [
          { id: 'a', lectura: { moneda: 'COP', total: 1, identidad: {}, campos: [], huellaImagen: 'h-1' } },
          { id: 'b', lectura: { moneda: 'COP', total: 1, identidad: {}, campos: [], huellaImagen: 'h-2' } },
        ],
      },
    }
    expect(opcionConLaMismaImagen('h-2', [conHabitaciones])?.id).toBe('h')
    expect(opcionConLaMismaImagen('h-3', [conHabitaciones])).toBeNull()
  })

  it('no se compara consigo misma', () => {
    expect(compararConExistentes(vuelo('x'), [vuelo('x')])).toBeNull()
  })
})

describe('misma opción con otro precio', () => {
  it('no es repetido: se ofrece reemplazar el precio', () => {
    const r = compararConExistentes(vuelo('n', { total: 1_400_000 }), [vuelo('v')])
    expect(r).toEqual({ tipo: 'otro_precio', con: expect.objectContaining({ id: 'v' }) })
  })

  it('otra moneda también es otro precio', () => {
    expect(compararConExistentes(vuelo('n', { moneda: 'USD', total: 320 }), [vuelo('v')])?.tipo).toBe('otro_precio')
  })

  it('una diferencia de redondeo (menos de una unidad) sigue siendo el mismo precio', () => {
    expect(compararConExistentes(vuelo('n', { total: 1_250_000.4 }), [vuelo('v')])?.tipo).toBe('parecida')
  })

  it('si hay una idéntica y otra con otro precio, manda la idéntica', () => {
    const r = compararConExistentes(vuelo('n'), [vuelo('cara', { total: 2_000_000 }), vuelo('igual')])
    expect(r).toEqual({ tipo: 'parecida', con: expect.objectContaining({ id: 'igual' }) })
  })
})
