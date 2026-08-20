import { describe, it, expect } from 'vitest'
import { estaObsoleta, decidirAccion, TECHO_EDAD_MS } from './decidir'

const UNA_HORA = 60 * 60 * 1000

describe('estaObsoleta', () => {
  it('un deploy nuevo la marca obsoleta aunque la pestaña sea reciente', () => {
    expect(estaObsoleta({
      versionCargada: 'dpl_viejo',
      versionViva: 'dpl_nuevo',
      edadMs: UNA_HORA,
    })).toBe(true)
  })

  it('la misma version y poca edad NO la marca obsoleta', () => {
    expect(estaObsoleta({
      versionCargada: 'dpl_x',
      versionViva: 'dpl_x',
      edadMs: UNA_HORA,
    })).toBe(false)
  })

  // El piso que pidio Mauricio: sin deploy de por medio, a las 8 horas se recarga igual.
  it('el techo de 8 horas la marca obsoleta aunque la version no haya cambiado', () => {
    expect(estaObsoleta({
      versionCargada: 'dpl_x',
      versionViva: 'dpl_x',
      edadMs: TECHO_EDAD_MS,
    })).toBe(true)
  })

  it('justo por debajo del techo todavia no', () => {
    expect(estaObsoleta({
      versionCargada: 'dpl_x',
      versionViva: 'dpl_x',
      edadMs: TECHO_EDAD_MS - 1,
    })).toBe(false)
  })

  // Si /api/version falla, tratar el fallo como "hay version nueva" recargaria en bucle
  // a toda la operacion justo cuando algo ya esta roto.
  it('una version viva nula NO cuenta como obsoleta', () => {
    expect(estaObsoleta({
      versionCargada: 'dpl_x',
      versionViva: null,
      edadMs: UNA_HORA,
    })).toBe(false)
  })

  it('una version viva vacia NO cuenta como obsoleta', () => {
    expect(estaObsoleta({
      versionCargada: 'dpl_x',
      versionViva: '',
      edadMs: UNA_HORA,
    })).toBe(false)
  })

  // Pero la edad manda por encima de todo: una pestaña de 16 dias se recarga
  // aunque el endpoint de version no responda.
  it('el techo manda aunque la version viva sea nula', () => {
    expect(estaObsoleta({
      versionCargada: 'dpl_x',
      versionViva: null,
      edadMs: TECHO_EDAD_MS + 1,
    })).toBe(true)
  })

  it('el techo se puede acortar por parametro', () => {
    expect(estaObsoleta({
      versionCargada: 'dpl_x',
      versionViva: 'dpl_x',
      edadMs: 2 * UNA_HORA,
      techoMs: UNA_HORA,
    })).toBe(true)
  })
})

describe('decidirAccion', () => {
  it('no obsoleta: no se hace nada', () => {
    expect(decidirAccion({ obsoleta: false, trabajoEnCurso: false, enLinea: true })).toBe('nada')
  })

  it('obsoleta y sin nada que perder: recarga sola', () => {
    expect(decidirAccion({ obsoleta: true, trabajoEnCurso: false, enLinea: true })).toBe('recargar')
  })

  it('obsoleta pero con trabajo en curso: avisa y espera', () => {
    expect(decidirAccion({ obsoleta: true, trabajoEnCurso: true, enLinea: true })).toBe('avisar')
  })

  // Recargar sin red cambia una pantalla que funciona a medias por una que no carga.
  it('sin conexion no se hace nada, ni siquiera avisar', () => {
    expect(decidirAccion({ obsoleta: true, trabajoEnCurso: false, enLinea: false })).toBe('nada')
    expect(decidirAccion({ obsoleta: true, trabajoEnCurso: true, enLinea: false })).toBe('nada')
  })
})
