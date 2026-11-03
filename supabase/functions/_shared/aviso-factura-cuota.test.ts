import { describe, expect, it } from 'vitest'
import {
  ENLACE_PAGOS,
  contenidoAvisoFactura,
  destinatariosAvisoFactura,
  elegirContrato,
  grupoClaveFactura,
  planAvisoFactura,
  type ContratoAviso,
} from './aviso-factura-cuota'

const contrato = (c: Partial<ContratoAviso>): ContratoAviso => ({
  id: 'c',
  estado: 'activo',
  vigente_desde: '2026-09-23',
  workspace_pagador_id: 'pag',
  aceptante_designado_id: 'des',
  ...c,
})

describe('aviso de factura cargada: reglas', () => {
  it('el texto dice la factura y la cuota, y si es un reemplazo', () => {
    expect(contenidoAvisoFactura({ numeroFactura: 'FE-6', numeroCuota: 1, reemplazo: false })).toBe(
      'Ya está tu factura FE-6 de la cuota 1. Descárgala en Pagos.',
    )
    expect(contenidoAvisoFactura({ numeroFactura: 'FE-6', numeroCuota: 1, reemplazo: true })).toBe(
      'Se actualizó tu factura FE-6 de la cuota 1. Descárgala en Pagos.',
    )
    expect(contenidoAvisoFactura({ numeroFactura: 'FE-6', numeroCuota: null, reemplazo: false })).toBe(
      'Ya está tu factura FE-6. Descárgala en Pagos.',
    )
  })

  it('una identidad por cuota y el enlace a la pestaña Pagos', () => {
    expect(grupoClaveFactura('q1')).toBe('factura_cuota:q1')
    expect(ENLACE_PAGOS).toBe('/suscripcion?tab=pagos')
  })

  it('con un contrato cancelado y otro activo en el mismo negocio manda el activo (caso El Carmen)', () => {
    const cancelado = contrato({ id: 'viejo', estado: 'cancelado', aceptante_designado_id: 'oficial' })
    const activo = contrato({ id: 'nuevo', estado: 'activo', aceptante_designado_id: 'cda' })
    expect(elegirContrato([cancelado, activo])?.id).toBe('nuevo')
    expect(elegirContrato([activo, cancelado])?.id).toBe('nuevo')
  })

  it('entre iguales, el de vigencia más reciente; sin contratos, ninguno', () => {
    const a = contrato({ id: 'a', estado: 'cancelado', vigente_desde: '2026-01-01' })
    const b = contrato({ id: 'b', estado: 'cancelado', vigente_desde: '2026-06-01' })
    expect(elegirContrato([a, b])?.id).toBe('b')
    expect(elegirContrato([])).toBeNull()
  })

  it('el destinatario es solo la persona designada (la única que ve Pagos)', () => {
    expect(destinatariosAvisoFactura(contrato({ aceptante_designado_id: 'des' }))).toEqual(['des'])
    expect(destinatariosAvisoFactura(contrato({ aceptante_designado_id: null }))).toEqual([])
    expect(destinatariosAvisoFactura(null)).toEqual([])
  })

  it('con un aviso pendiente de la misma cuota lo actualiza; sin él, crea uno', () => {
    expect(planAvisoFactura(['des'], [])).toEqual({ actualizar: [], crear: ['des'] })
    expect(planAvisoFactura(['des'], [{ id: 'n1', destinatario_id: 'des' }])).toEqual({ actualizar: ['n1'], crear: [] })
    // El pendiente de otra persona no es de este aviso: ni se toca ni impide crear el del designado.
    expect(planAvisoFactura(['des'], [{ id: 'n2', destinatario_id: 'otro' }])).toEqual({ actualizar: [], crear: ['des'] })
    // Un destinatario repetido no crea dos.
    expect(planAvisoFactura(['des', 'des'], [])).toEqual({ actualizar: [], crear: ['des'] })
  })
})
