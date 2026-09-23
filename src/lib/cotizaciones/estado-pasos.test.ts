/** P9 del caso Providencia: el viaje es el encabezado, no un paso (Mauricio, 2026-09-23). */
import { describe, expect, it } from 'vitest'

import { encabezadoDelViaje, estadoDePasos, type EntradaPasos } from './estado-pasos'

const VIAJE: EntradaPasos['viaje'] = {
  destino: 'Providencia',
  fechas: { inicio: '2026-11-09', fin: '2026-11-13' },
  composicion: { adultos: 2, ninos: 0, infantes: 1 },
}

const BASE: EntradaPasos = {
  viaje: VIAJE,
  ranuras: [{ etiqueta: 'Vuelo', opciones: 1, conCosto: 1 }],
  sueltasSinCosto: 0,
  tarifasEnPropuesta: 1,
  texto: 'revisado',
  bloqueoEnvio: null,
  estadoCotizacion: 'borrador',
}

describe('el encabezado del viaje', () => {
  it('completo: el resumen y sin motivo', () => {
    const e = encabezadoDelViaje(VIAJE)
    expect(e.resumen).toBe('Providencia · 9 al 13 nov 2026 · 2 adultos, 1 infante')
    expect(e.motivo).toBeNull()
  })
  it('sin fechas, sin pasajeros o sin los dos: dice qué falta en el negocio', () => {
    expect(encabezadoDelViaje({ ...VIAJE, fechas: null }).motivo).toBe('Faltan las fechas del viaje en el negocio')
    expect(encabezadoDelViaje({ ...VIAJE, composicion: null }).motivo).toBe('Faltan los pasajeros en el negocio')
    expect(encabezadoDelViaje({ ...VIAJE, fechas: { inicio: null, fin: null }, composicion: null }).motivo)
      .toBe('Faltan las fechas y los pasajeros en el negocio')
  })
})

describe('los cuatro pasos', () => {
  it('ya no hay paso «viaje»', () => {
    expect(Object.keys(estadoDePasos(BASE))).toEqual(['componentes', 'tarifas', 'texto', 'revisar'])
  })
  it('«Revisar y enviar» lista lo que le falta al viaje como pendiente', () => {
    const r = estadoDePasos({ ...BASE, viaje: { ...VIAJE, composicion: null } }).revisar
    expect(r).toEqual({ estado: 'pendiente', detalle: 'Faltan los pasajeros en el negocio' })
  })
  it('con un bloqueo de envío, el error manda y el faltante del viaje se suma', () => {
    const r = estadoDePasos({ ...BASE, bloqueoEnvio: 'Falta el costo de X.', viaje: { ...VIAJE, fechas: null } }).revisar
    expect(r.estado).toBe('error')
    expect(r.detalle).toBe('Falta el costo de X. · Faltan las fechas del viaje en el negocio')
  })
  it('con el viaje completo y nada que impida, está lista', () => {
    expect(estadoDePasos(BASE).revisar).toEqual({ estado: 'pendiente', detalle: 'Lista para revisar y enviar' })
  })
})
