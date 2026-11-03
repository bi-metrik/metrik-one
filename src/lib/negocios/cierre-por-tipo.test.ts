/**
 * Servicios del viaje no se cierra al completarse ni por área (QA Trappvel 2026-10-29):
 *  · M1-1 / M6-1: con la confirmación del último servicio antes que su voucher, el bloque quedaba
 *    «Completo» y en solo lectura, y el voucher que exige E6 no se podía subir en ninguna etapa;
 *  · H3-1: la comercial responsable no veía el botón del voucher en Reservas y pagos.
 */
import { describe, expect, it } from 'vitest'
import { areaNoCierraElBloque, completoCierraLaEdicion } from './cierre-por-tipo'

describe('completoCierraLaEdicion', () => {
  it('servicios, datos y documento siguen abiertos al completarse; lo demás se cierra', () => {
    expect(completoCierraLaEdicion('servicios')).toBe(false)
    expect(completoCierraLaEdicion('datos')).toBe(false)
    expect(completoCierraLaEdicion('documento')).toBe(false)
    expect(completoCierraLaEdicion('checklist')).toBe(true)
    expect(completoCierraLaEdicion('cobros')).toBe(true)
    expect(completoCierraLaEdicion(null)).toBe(true)
  })
})

describe('areaNoCierraElBloque', () => {
  it('solo servicios: sus permisos son por fila', () => {
    expect(areaNoCierraElBloque('servicios')).toBe(true)
    expect(areaNoCierraElBloque('documento')).toBe(false)
    expect(areaNoCierraElBloque(undefined)).toBe(false)
  })
})
