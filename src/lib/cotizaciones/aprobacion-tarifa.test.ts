import { describe, expect, it } from 'vitest'

import { preseleccionDeAprobacion, textoDeAprobacion, validarTarifaElegida } from './aprobacion-tarifa'

const tarifa = (id: string, nombre: string, vaEnPropuesta = true) => ({ id, nombre, orden: 1, vaEnPropuesta })
const TRES = [tarifa('eco', 'Económica'), tarifa('rec', 'Recomendada'), tarifa('pre', 'Premium')]

describe('validarTarifaElegida', () => {
  it('sin tarifas se aprueba por el total, sin escoger nada (R6)', () => {
    expect(validarTarifaElegida([], null)).toEqual({ ok: true, tarifa: null })
    expect(validarTarifaElegida([], undefined)).toEqual({ ok: true, tarifa: null })
  })

  it('sin tarifas, mandar una es un cliente desactualizado o una llamada directa', () => {
    const r = validarTarifaElegida([], 'pre')
    expect(r.ok).toBe(false)
  })

  it('con tarifas, aprobar SIN escoger se rechaza: no se aprueba con el precio de la Recomendada por omisión', () => {
    const r = validarTarifaElegida(TRES, null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('escoge cuál tomó el cliente')
  })

  it('con tarifas, la Premium escogida vale', () => {
    const r = validarTarifaElegida(TRES, 'pre')
    expect(r).toEqual({ ok: true, tarifa: TRES[2] })
  })

  it('una tarifa que no iba en la propuesta no se puede escoger: el cliente no la vio', () => {
    const r = validarTarifaElegida([...TRES.slice(0, 2), tarifa('pre', 'Premium', false)], 'pre')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('no iba en la propuesta')
  })

  it('una tarifa de otra cotización no se puede escoger', () => {
    expect(validarTarifaElegida(TRES, 'de-otra').ok).toBe(false)
  })
})

describe('preseleccionDeAprobacion', () => {
  const opciones = TRES.map(t => ({ itinerarioId: t.id, nombre: t.nombre }))

  it('por defecto ofrece la Recomendada', () => {
    expect(preseleccionDeAprobacion(opciones, null)).toBe('rec')
  })

  it('tras corregir una aprobación, ofrece la que el cliente ya había escogido', () => {
    expect(preseleccionDeAprobacion(opciones, 'pre')).toBe('pre')
  })

  it('si la escogida ya no está entre las opciones, vuelve a la Recomendada', () => {
    expect(preseleccionDeAprobacion(opciones, 'borrada')).toBe('rec')
  })
})

describe('textoDeAprobacion', () => {
  it('con otra tarifa, dice cuánto era la Recomendada: explica por qué el precio no es el TOTAL del documento', () => {
    const t = textoDeAprobacion({
      codigo: 'COT-2026-0009',
      tarifa: 'Premium',
      precio: '$ 8.400.000',
      recomendada: { nombre: 'Recomendada', precio: '$ 5.075.235' },
      eraLaRecomendada: false,
    })
    expect(t).toContain('escogió la tarifa Premium, por $ 8.400.000')
    expect(t).toContain('La Recomendada, que da el total del documento, era de $ 5.075.235')
  })

  it('con la Recomendada, no repite la cifra', () => {
    const t = textoDeAprobacion({
      codigo: 'COT-2026-0009',
      tarifa: 'Recomendada',
      precio: '$ 5.075.235',
      recomendada: { nombre: 'Recomendada', precio: '$ 5.075.235' },
      eraLaRecomendada: true,
    })
    expect(t).not.toContain('era de')
  })
})
