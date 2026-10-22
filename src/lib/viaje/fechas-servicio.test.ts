/**
 * Fechas de los servicios del viaje: lo leído de la cotización, el día del viaje, lo corregido a
 * mano y el completado de filas viejas. Casos sintéticos (sin datos de clientes).
 */
import { describe, expect, it } from 'vitest'
import {
  completadoDeFila,
  fechaPorDiaDelViaje,
  fechasDeFila,
  resumenDeFechas,
  SIN_FECHAS,
  validarFechasEditadas,
} from './fechas-servicio'
import { fechasDelServicio, filasDeServicioDeTarifa, type ItemParaServicio } from './servicios-desde-tarifa'

const lectura = (identidad: Record<string, string | null>, campos: Array<{ label: string; valor: string }> = []) => ({
  casillas: { grupo_completo: { total: 1, moneda: 'COP', identidad, campos } },
})

const conLectura = (tarifa_pax: unknown, dia_relativo: number | null = null) =>
  ({ tarifa_pax: tarifa_pax as ItemParaServicio['tarifa_pax'], dia_relativo })

describe('lo leído de la cotización', () => {
  it('vuelo ida y vuelta: una fila con los dos tramos y sus horas; inicio = ida, fin = regreso', () => {
    const f = fechasDelServicio(conLectura(lectura(
      { aerolinea: 'Aerolínea X', origen: 'BOG', destino: 'ADZ', fecha_salida: '2026-11-10', fecha_regreso: '2026-11-15' },
      [
        { label: 'Hora de salida (ida)', valor: '06:10' },
        { label: 'Hora de llegada (ida)', valor: '07:45' },
        { label: 'Hora de salida (regreso)', valor: '18:30' },
        { label: 'Hora de llegada (regreso)', valor: '20:05' },
        { label: 'Nº de vuelo', valor: 'XX100' },
      ],
    )), 'vuelo', null)
    expect(f.tramos).toEqual([
      { fecha: '2026-11-10', hora_salida: '06:10', hora_llegada: '07:45', origen: 'BOG', destino: 'ADZ', aerolinea: 'Aerolínea X', numero_vuelo: 'XX100' },
      { fecha: '2026-11-15', hora_salida: '18:30', hora_llegada: '20:05', origen: 'ADZ', destino: 'BOG', aerolinea: 'Aerolínea X', numero_vuelo: null },
    ])
    expect([f.fecha_servicio, f.hora_inicio, f.fecha_fin, f.hora_fin]).toEqual(['2026-11-10', '06:10', '2026-11-15', '20:05'])
  })

  it('vuelo solo ida: un tramo y fin = inicio', () => {
    const f = fechasDelServicio(conLectura(lectura(
      { aerolinea: 'Aerolínea X', origen: 'BOG', destino: 'ADZ', fecha_salida: '2026-11-10', fecha_regreso: null },
      [{ label: 'Hora de salida (ida)', valor: '06:10' }],
    )), 'vuelo', null)
    expect(f.tramos).toHaveLength(1)
    expect([f.fecha_servicio, f.fecha_fin, f.hora_inicio]).toEqual(['2026-11-10', '2026-11-10', '06:10'])
  })

  it('una hora que vino del viaje y no de la pantalla no se toma; un regreso antes de la ida se cae', () => {
    const f = fechasDelServicio(conLectura(lectura(
      { fecha_salida: '2026-11-10', fecha_regreso: '2026-11-01' },
      [{ label: 'Hora de salida (ida)', valor: '06:10 (del viaje)' }],
    )), 'vuelo', null)
    expect(f.tramos).toHaveLength(1)
    expect(f.hora_inicio).toBeNull()
  })

  it('vuelo sin fecha de ida: sin tramos, «Falta la fecha» (no se arma desde el regreso)', () => {
    const f = fechasDelServicio(conLectura(lectura({ fecha_salida: '--11-10', fecha_regreso: '2026-11-15' })), 'vuelo', '2026-11-10')
    expect(f).toEqual(SIN_FECHAS)
  })

  it('hotel de 3 noches guarda check-in y check-out', () => {
    const f = fechasDelServicio(conLectura(lectura({ hotel: 'Hotel de prueba', check_in: '2026-11-10', check_out: '2026-11-13' })), 'hotel', null)
    expect([f.fecha_servicio, f.fecha_fin]).toEqual(['2026-11-10', '2026-11-13'])
  })

  it('actividad «día 2» con salida 10-nov queda el 11-nov; sin salida queda vacía', () => {
    expect(fechasDelServicio(conLectura(null, 2), 'actividad', '2026-11-10').fecha_servicio).toBe('2026-11-11')
    expect(fechasDelServicio(conLectura(null, 2), 'actividad', null).fecha_servicio).toBeNull()
    expect(fechasDelServicio(conLectura(null, null), 'actividad', '2026-11-10').fecha_servicio).toBeNull()
    // La fecha leída manda sobre el día del viaje.
    expect(fechasDelServicio(conLectura(lectura({ fecha: '2026-11-14' }), 2), 'actividad', '2026-11-10').fecha_servicio).toBe('2026-11-14')
  })

  it('traslado: conserva la hora de `fecha_hora`; sin fecha leída, el día del viaje', () => {
    const f = fechasDelServicio(conLectura(lectura({ fecha_hora: '2026-11-10T14:30' })), 'traslado', null)
    expect([f.fecha_servicio, f.hora_inicio]).toEqual(['2026-11-10', '14:30'])
    expect(fechasDelServicio(conLectura(null, 1), 'traslado', '2026-11-10').fecha_servicio).toBe('2026-11-10')
  })

  it('el día del viaje solo con un entero ≥ 1', () => {
    expect(fechaPorDiaDelViaje('2026-11-30', 2)).toBe('2026-12-01')
    expect(fechaPorDiaDelViaje('2026-11-10', 0)).toBeNull()
    expect(fechaPorDiaDelViaje('2026-11-10', 1.5)).toBeNull()
  })

  it('las filas de la tarifa llevan sus fechas', () => {
    const base: ItemParaServicio = {
      id: 'tour', nombre: 'Tour', grupo: 'actividad', opcion_de: null, es_ajuste: false, orden: 1, dia_relativo: 3,
      entra_al_precio: null, cantidad: 1, subtotal: 100, numeroDeRubros: 0, costoDeRubros: 0, descuento_porcentaje: 0,
      margen_porcentaje: null, precio_venta: 120, precio_manual: false, adicionales: [], pasajeros: null, tarifa_pax: null,
    }
    const [fila] = filasDeServicioDeTarifa({
      items: [base], seleccion: null, salidaViaje: '2026-11-10',
      params: { administrativosPct: 0, margenPct: 15, descuentoComercialPct: 0, convencionMargen: 'sobre_venta' },
    })
    expect([fila.fecha_servicio, fila.fecha_fin, fila.tramos]).toEqual(['2026-11-12', null, null])
  })
})

describe('lo corregido a mano', () => {
  it('fin anterior al inicio se rechaza; fin sin inicio también', () => {
    expect(validarFechasEditadas('hotel', { fecha_servicio: '2026-11-13', fecha_fin: '2026-11-10' })).toEqual({ ok: false, error: 'El fin no puede ser antes del inicio.' })
    expect(validarFechasEditadas('hotel', { fecha_fin: '2026-11-10' })).toEqual({ ok: false, error: 'Pon primero la fecha de inicio.' })
    expect(validarFechasEditadas('traslado', { fecha_servicio: '2026-11-10', hora_inicio: '15:00', hora_fin: '14:00' }).ok).toBe(false)
    expect(validarFechasEditadas('hotel', { fecha_servicio: '2026-11-10', fecha_fin: '2026-11-13' })).toEqual({
      ok: true, fechas: { fecha_servicio: '2026-11-10', fecha_fin: '2026-11-13', hora_inicio: null, hora_fin: null, tramos: null },
    })
  })

  it('tramos: cada uno con fecha, en orden; el fin sale del último', () => {
    expect(validarFechasEditadas('vuelo', { tramos: [{ fecha: '2026-11-15' }, { fecha: '2026-11-10' }] }))
      .toEqual({ ok: false, error: 'El tramo 2 sale antes que el tramo 1.' })
    expect(validarFechasEditadas('vuelo', { tramos: [{ fecha: '' }] })).toEqual({ ok: false, error: 'Falta la fecha del tramo 1.' })
    expect(validarFechasEditadas('vuelo', { tramos: [{ fecha: '2026-11-10', hora_salida: '25:00' }] }).ok).toBe(false)
    const ok = validarFechasEditadas('vuelo', { tramos: [{ fecha: '2026-11-10', hora_salida: '06:10' }, { fecha: '2026-11-15', hora_llegada: '20:05' }] })
    expect(ok.ok && [ok.fechas.fecha_servicio, ok.fechas.hora_inicio, ok.fechas.fecha_fin, ok.fechas.hora_fin]).toEqual(['2026-11-10', '06:10', '2026-11-15', '20:05'])
  })
})

describe('completar filas ya generadas', () => {
  it('escribe las fechas leídas como un todo; si la lectura no trae inicio, no borra nada', () => {
    const vieja = fechasDeFila({ fecha_servicio: '2026-11-10' })
    const leidas = { ...SIN_FECHAS, fecha_servicio: '2026-11-10', fecha_fin: '2026-11-13' }
    expect(completadoDeFila(vieja, leidas)).toEqual(leidas)
    expect(completadoDeFila(fechasDeFila({ fecha_servicio: '2026-11-10', fecha_fin: '2026-11-13' }), leidas)).toBeNull()
    expect(completadoDeFila(vieja, SIN_FECHAS)).toBeNull()
  })

  it('las horas de la base (con segundos) y los tramos jsonb se leen sin confiar en su forma', () => {
    const f = fechasDeFila({ fecha_servicio: '2026-11-10', hora_inicio: '06:10:00', tramos: [{ fecha: '2026-11-10', hora_salida: '06:10' }, { fecha: 'mal' }, 'x'] })
    expect(f.hora_inicio).toBe('06:10')
    expect(f.tramos).toEqual([{ fecha: '2026-11-10', hora_salida: '06:10', hora_llegada: null, origen: null, destino: null, aerolinea: null, numero_vuelo: null }])
  })

  it('en pantalla: «mar 10 nov · 06:10 → dom 15 nov», y nada sin inicio', () => {
    expect(resumenDeFechas({ ...SIN_FECHAS, fecha_servicio: '2026-11-10', hora_inicio: '06:10', fecha_fin: '2026-11-15' })).toBe('mar 10 nov · 06:10 → dom 15 nov')
    expect(resumenDeFechas({ ...SIN_FECHAS, fecha_servicio: '2026-11-10', fecha_fin: '2026-11-10', hora_inicio: '06:10', hora_fin: '07:45' })).toBe('mar 10 nov · 06:10 → 07:45')
    expect(resumenDeFechas(SIN_FECHAS)).toBeNull()
  })
})
