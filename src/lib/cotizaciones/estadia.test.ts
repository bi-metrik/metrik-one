/**
 * Corregir las fechas de una opción de hotel (brief del 2026-09-30).
 *
 * Caso COT-2026-0019 (negocio de prueba): «PRUEBA Lord», 1 adulto a 100.000 neto por noche,
 * entrada escrita el 9 de octubre por error y salida el 13 de noviembre (35 noches,
 * 3.500.000). Se corrigió la entrada al 9 de noviembre: 4 noches, 400.000. Después entró
 * «Hotel PRUEBA Lord» 1A+1I del 9 al 13 de noviembre como habitación 2.
 */
import { describe, expect, it } from 'vitest'

import type { Correcciones } from './correcciones'
import { hotelesDeItems } from './detalle-viaje'
import { avisoDeEstadia, casillasConEstadia, estadiaDeHabitacion, firmaDeEstadia, lecturaConEstadia } from './estadia'
import {
  precioPorHabitacion,
  repartirHabitaciones,
  resolverHabitaciones,
  resolverTarifaDeOpcion,
  tarifaConHabitaciones,
} from './habitaciones'
import { lecturaManual, type HotelManual } from './ingreso-manual'
import { ranuraPorSlug } from './ranuras-pantallazo'
import { confirmacionDesactualizada, type Composicion, type LecturaCasilla, type TarifaPax } from './tarifa-pasajero'

const HOTEL = ranuraPorSlug('hotel_detalle')!
const AHORA = '2026-09-30T15:00:00Z'
const GRUPO: Composicion = { adultos: 2, ninos: 0, infantes: 1 }

const lord = (over: Partial<HotelManual> = {}): LecturaCasilla => {
  const r = lecturaManual({
    ranura: HOTEL,
    entrada: {
      tipo: 'hotel',
      datos: {
        hotel: 'PRUEBA Lord',
        ciudad: 'San Andrés',
        entrada: '2026-10-09',
        salida: '2026-11-13',
        habitacion: 'Estándar',
        regimen: '',
        incluye: '',
        adultos: 1,
        ninos: 0,
        infantes: 0,
        netoAdulto: 100_000,
        netoNino: null,
        netoInfante: null,
        edadDesde: null,
        edadHasta: null,
        fuente: 'Telefónico',
        ...over,
      },
    },
    leidaEn: AHORA,
    hoy: '2026-09-30',
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  return r.lectura
}

const corregida = (campos: Record<string, string | null>): Correcciones =>
  Object.fromEntries(Object.entries(campos).map(([k, valor]) => [k, { valor, por: 'Mauricio', porId: null, en: AHORA }]))

const ENTRADA_9_NOV = corregida({ check_in: '2026-11-09' })

/** Un pantallazo: el precio es el de la plataforma para sus fechas, no hay neto por noche. */
const pantallazo = (l: LecturaCasilla): LecturaCasilla => {
  const { origen: _o, manual: _m, ...resto } = l
  void _o
  void _m
  return resto
}

describe('una habitación a mano con la entrada corregida', () => {
  it('COT-2026-0019: 35 noches → 4, 3.500.000 → 400.000; el neto es el mismo', () => {
    const l = lord()
    expect(l.total).toBe(3_500_000)
    const e = estadiaDeHabitacion(l, ENTRADA_9_NOV)
    expect(e).toMatchObject({ entrada: '2026-11-09', salida: '2026-11-13', nochesLeidas: 35, noches: 4, cambio: true })
    const c = lecturaConEstadia(l, ENTRADA_9_NOV)
    expect(c.total).toBe(400_000)
    expect(c.porTipo).toEqual([{ tipo: 'adulto', cantidad: 1, subtotal: 400_000 }])
    // Lo escrito no se toca.
    expect(l.total).toBe(3_500_000)
  })

  it('opción de una sola habitación: el costo por pasajero sale de las noches corregidas', () => {
    const tarifa: TarifaPax = { casillas: { grupo_completo: lord() }, correcciones: ENTRADA_9_NOV }
    const e = resolverTarifaDeOpcion(tarifa, { adultos: 1, ninos: 0, infantes: 0 }, null, 'hotel_detalle')
    expect(e?.estado).toBe('resuelta')
    if (e?.estado === 'resuelta') expect(e.costoTotal).toBe(400_000)
  })

  it('con la habitación 2 ya en noviembre: la corrección es de la opción y la 2 no cambia', () => {
    const h1 = lord()
    const h2 = lord({ hotel: 'Hotel PRUEBA Lord', entrada: '2026-11-09', infantes: 1, netoInfante: 0 })
    expect(h2.total).toBe(400_000)
    const tarifa = { ...tarifaConHabitaciones({}, [{ id: 'grupo_completo', lectura: h1 }, { id: 'h2', lectura: h2 }], GRUPO), correcciones: ENTRADA_9_NOV }
    const r = repartirHabitaciones(tarifa.habitaciones!, GRUPO, tarifa.correcciones)
    expect(r.habitaciones.map(h => h.total)).toEqual([400_000, 400_000])
    expect(r.habitaciones.map(h => h.avisoEstadia)).toEqual([null, null])
    const e = resolverHabitaciones(tarifa, GRUPO)
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.costoTotal).toBe(800_000)
    // Mismo tipo de habitación, una de solo adultos: el costo se parte por pasajero y el
    // adulto cuesta las 4 noches (el infante, la diferencia: 0).
    expect(e.costos.map(c => [c.tipo, c.cantidad, c.unitario])).toEqual([['adulto', 2, 400_000], ['infante', 1, 0]])
  })

  it('sin par para restar, el precio de la opción se reparte por habitación en proporción al costo corregido', () => {
    const h1 = lord()
    const h2 = lord({ hotel: 'Hotel PRUEBA Lord', habitacion: 'Superior', entrada: '2026-11-09', infantes: 1, netoInfante: 0 })
    const tarifa = { ...tarifaConHabitaciones({}, [{ id: 'grupo_completo', lectura: h1 }, { id: 'h2', lectura: h2 }], GRUPO), correcciones: ENTRADA_9_NOV }
    const e = resolverHabitaciones(tarifa, GRUPO)
    expect(e.estado).toBe('resuelta')
    if (e.estado !== 'resuelta') return
    expect(e.porHabitacion?.map(h => h.total)).toEqual([400_000, 400_000])
    const precios = precioPorHabitacion(
      (e.porHabitacion ?? []).map(h => ({ numero: h.numero, ocupacion: h.ocupacion, totalCOP: h.total })),
      1_000_000,
    )
    // Con 3.500.000 en la habitación 1, le habría tocado casi todo el precio.
    expect(precios.map(p => p.precio)).toEqual([500_000, 500_000])
  })

  it('sin la corrección todo sigue como antes (35 noches, 3.500.000)', () => {
    const tarifa: TarifaPax = { casillas: { grupo_completo: lord() } }
    const e = resolverTarifaDeOpcion(tarifa, { adultos: 1, ninos: 0, infantes: 0 }, null, 'hotel_detalle')
    if (e?.estado === 'resuelta') expect(e.costoTotal).toBe(3_500_000)
    expect(casillasConEstadia(tarifa.casillas!, undefined)).toBe(tarifa.casillas)
  })

  it('volver a la fecha escrita deshace el cambio', () => {
    const l = lord()
    expect(lecturaConEstadia(l, corregida({ check_in: '2026-10-09' }))).toBe(l)
  })

  it('la ficha y el documento dicen las fechas y las noches corregidas', () => {
    const item = { nombre: 'PRUEBA LORD', grupo: 'hotel', tarifa_pax: { casillas: { grupo_completo: lord() }, correcciones: ENTRADA_9_NOV } }
    const [h] = hotelesDeItems([item])
    expect(h.checkIn).not.toContain('oct')
    expect(h.noches).toBe(4)
    // Sin corrección, las de siempre.
    const [antes] = hotelesDeItems([{ ...item, tarifa_pax: { casillas: { grupo_completo: lord() } } }])
    expect(antes.noches).toBe(35)
  })

  it('una confirmación hecha con las noches viejas queda vieja; la nueva, no', () => {
    const base: TarifaPax = { casillas: { grupo_completo: lord() }, composicion: { adultos: 1, ninos: 0, infantes: 0 } }
    const confirmada = { composicion: { adultos: 1, ninos: 0, infantes: 0 }, costos: [], costoTotalCOP: 3_500_000, moneda: 'COP', tasa: null, confirmadaEn: AHORA }
    // Sin correcciones, la confirmación de siempre sigue vigente.
    expect(confirmacionDesactualizada({ ...base, confirmada }, null)).toBeNull()
    // COT-2026-0019 hoy: corregida después de confirmar.
    const vieja = confirmacionDesactualizada({ ...base, correcciones: ENTRADA_9_NOV, confirmada }, null)
    expect(vieja?.mensaje).toContain('Cambiaron las fechas')
    const firma = firmaDeEstadia([{ id: 'grupo_completo', lectura: base.casillas!.grupo_completo! }], ENTRADA_9_NOV)
    expect(firma).toBe('grupo_completo:4')
    expect(confirmacionDesactualizada({ ...base, correcciones: ENTRADA_9_NOV, confirmada: { ...confirmada, firmaEstadia: firma } }, null)).toBeNull()
  })
})

describe('una habitación de pantallazo con las fechas corregidas', () => {
  it('conserva el costo y avisa que hay que volver a pegar el pantallazo', () => {
    const l = pantallazo(lord())
    expect(lecturaConEstadia(l, ENTRADA_9_NOV)).toBe(l)
    const tarifa = { ...tarifaConHabitaciones({}, [{ id: 'grupo_completo', lectura: l }], GRUPO), correcciones: ENTRADA_9_NOV }
    const [fila] = repartirHabitaciones(tarifa.habitaciones!, GRUPO, tarifa.correcciones).habitaciones
    expect(fila.total).toBe(3_500_000)
    expect(fila.avisoEstadia).toBe('El precio es el del pantallazo para 35 noches; cambiaste a 4 noches. Vuelve a pegar el pantallazo.')
    // No deja vieja la confirmación: el costo no cambió.
    expect(firmaDeEstadia(tarifa.habitaciones!, ENTRADA_9_NOV)).toBe('')
  })

  it('si las noches no cambian, no hay aviso', () => {
    const l = pantallazo(lord())
    expect(avisoDeEstadia(l, corregida({ check_in: '2026-10-10', check_out: '2026-11-14' }))).toBeNull()
  })
})

describe('habitaciones con fechas distintas en la misma opción', () => {
  it('se dice, no se decide cuál es la buena', () => {
    const h1 = lord({ entrada: '2026-11-09' })
    const h2 = lord({ entrada: '2026-11-10' })
    const r = repartirHabitaciones([{ id: 'h1', lectura: h1 }, { id: 'h2', lectura: h2 }], GRUPO, corregida({ check_out: '2026-11-14' }))
    expect(r.habitaciones[0].avisoEstadia).toBeNull()
    expect(r.habitaciones[1].avisoEstadia).toBe('Esta habitación va del 10 nov al 14 nov y la opción del 9 nov al 14 nov. Revisa las fechas.')
    // Cada una cuesta sus propias noches con la salida corregida: 5 y 4.
    expect(r.habitaciones.map(h => h.total)).toEqual([500_000, 400_000])
  })
})
