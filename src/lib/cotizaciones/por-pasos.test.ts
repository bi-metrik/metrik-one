/**
 * C1 · el interruptor de la cotización por pasos (criterio N5 de Vera): solo enciende con las
 * CUATRO condiciones, y hay una prueba por cada una que falte.
 */
import { describe, expect, it } from 'vitest'

import {
  estadoPorPasos,
  leerConfigPorPasos,
  piezaEncendida,
  porPasos,
  PIEZAS_POR_PASOS,
  rechazoPorPasos,
  type EntradaPorPasos,
} from './por-pasos'

const ENCENDIDO = { cotizacion_por_pasos: { activo: true } }
const TODO: EntradaPorPasos = { lineasPorTipo: true, plantilla: 'trappvel', configWorkspace: ENCENDIDO, estado: 'borrador' }

describe('N5 · las cuatro condiciones', () => {
  it('con las cuatro, enciende', () => {
    expect(porPasos(TODO)).toBe(true)
    expect(estadoPorPasos(TODO).motivo).toBeNull()
  })

  it('sin líneas por tipo (no es de viaje), apagado', () => {
    expect(porPasos({ ...TODO, lineasPorTipo: false })).toBe(false)
    expect(estadoPorPasos({ ...TODO, lineasPorTipo: false }).motivo).toBe('no_es_viaje')
  })

  it('con otra plantilla (termotech, metrik o ninguna), apagado aunque la clave esté encendida', () => {
    for (const plantilla of ['termotech', 'metrik', null, undefined, 'Trappvel']) {
      expect(porPasos({ ...TODO, plantilla })).toBe(false)
      expect(estadoPorPasos({ ...TODO, plantilla }).motivo).toBe('otra_plantilla')
    }
  })

  it('sin la clave, o con la clave apagada o mal escrita, apagado', () => {
    for (const configWorkspace of [
      null, undefined, {}, 'activo', { cotizacion_por_pasos: null },
      { cotizacion_por_pasos: { activo: false } },
      { cotizacion_por_pasos: { activo: 'true' } },
      { cotizacion_por_pasos: { activo: 1 } },
      { cotizacion_por_pasos: true },
      { cotizacion_por_pasos: { piezas: { lista_unica: true } } },
    ]) {
      expect(porPasos({ ...TODO, configWorkspace }), JSON.stringify(configWorkspace)).toBe(false)
      expect(estadoPorPasos({ ...TODO, configWorkspace }).motivo).toBe('interruptor_apagado')
    }
  })

  it('una cotización enviada, aceptada o rechazada se abre con la pantalla de hoy (N7)', () => {
    for (const estado of ['enviada', 'aceptada', 'rechazada', 'vencida', null, undefined]) {
      expect(porPasos({ ...TODO, estado }), String(estado)).toBe(false)
      expect(estadoPorPasos({ ...TODO, estado }).motivo).toBe('no_es_borrador')
    }
  })
})

describe('C1 · las piezas', () => {
  it('con el maestro encendido, una pieza ausente está encendida y solo `false` la apaga', () => {
    const config = leerConfigPorPasos({ cotizacion_por_pasos: { activo: true, piezas: { modelo_destino: false, lista_unica: 'no' } } })
    expect(config.activo).toBe(true)
    expect(config.piezas.modelo_destino).toBe(false)
    expect(config.piezas.lista_unica).toBe(true)
    expect(config.piezas.toda_opcion_en_tarifas).toBe(true)
  })

  it('con el maestro apagado, las piezas no cuentan', () => {
    const config = leerConfigPorPasos({ cotizacion_por_pasos: { activo: false, piezas: { modelo_destino: true } } })
    expect(Object.values(config.piezas).every(v => v === false)).toBe(true)
  })

  it('una pieza solo cuenta con las cuatro condiciones', () => {
    const enviada = estadoPorPasos({ ...TODO, estado: 'enviada' })
    for (const p of PIEZAS_POR_PASOS) expect(piezaEncendida(enviada, p)).toBe(false)
    const ok = estadoPorPasos(TODO)
    for (const p of PIEZAS_POR_PASOS) expect(piezaEncendida(ok, p)).toBe(true)
  })

  it('el rechazo del servidor dice qué hacer', () => {
    expect(rechazoPorPasos('interruptor_apagado')).toMatch(/Recarga la página/)
    expect(rechazoPorPasos('no_es_borrador')).toMatch(/Duplícala/)
    expect(rechazoPorPasos('pieza_apagada')).toMatch(/apagada/)
  })
})
