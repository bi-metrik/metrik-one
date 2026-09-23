import { describe, expect, it } from 'vitest'

import { desenlaceDeAceptar } from './aceptar-captura'

describe('desenlaceDeAceptar (R1: un faltante de la tarifa nunca frena aceptar)', () => {
  it('éxito → aceptada', () => {
    expect(desenlaceDeAceptar({ success: true })).toEqual({ tipo: 'aceptada' })
  })

  it('faltante (PENDIENTE) → aceptada con pendiente, nunca error', () => {
    const d = desenlaceDeAceptar({ success: false, codigo: 'PENDIENTE', error: 'Falta la captura de infantes.' })
    expect(d.tipo).toBe('pendiente')
    if (d.tipo === 'pendiente') {
      expect(d.mensaje).toContain('Aceptada')
      expect(d.mensaje).toContain('Falta la captura de infantes.')
    }
  })

  it('PENDIENTE sin texto sigue siendo pendiente', () => {
    expect(desenlaceDeAceptar({ success: false, codigo: 'PENDIENTE' }).tipo).toBe('pendiente')
  })

  it('fallo al guardar (ERROR) → error con su mensaje', () => {
    expect(desenlaceDeAceptar({ success: false, codigo: 'ERROR', error: 'No se pudo guardar.' }))
      .toEqual({ tipo: 'error', mensaje: 'No se pudo guardar.' })
  })

  it('sin contexto (CONTEXTO) → error', () => {
    expect(desenlaceDeAceptar({ success: false, codigo: 'CONTEXTO', error: 'Sin sesión.' }).tipo).toBe('error')
  })

  it('respuesta vacía o rota → error, no aceptada', () => {
    expect(desenlaceDeAceptar(null).tipo).toBe('error')
    expect(desenlaceDeAceptar(undefined).tipo).toBe('error')
    expect(desenlaceDeAceptar({} as never).tipo).toBe('error')
  })
})
