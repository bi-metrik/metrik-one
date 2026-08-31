import { describe, it, expect } from 'vitest'
import {
  bloqueTieneRespuesta,
  faltanRequisitos,
  nombresDeRequisitos,
} from './requisitos-bloque'

describe('bloqueTieneRespuesta', () => {
  it('un bloque de DATOS respondido cuenta, aunque no tenga archivo ni campos IA', () => {
    // El caso que motiva el modulo: con el criterio del formulario (drive_url o
    // campos) este bloque salia faltante estando respondido.
    expect(bloqueTieneRespuesta({ servicio: 'completo' })).toBe(true)
  })

  it('un documento cargado cuenta', () => {
    expect(bloqueTieneRespuesta({ drive_url: 'https://drive/x' })).toBe(true)
    expect(bloqueTieneRespuesta({ storage_path: 'ws/neg/x.pdf' })).toBe(true)
  })

  it('campos extraidos por IA cuentan', () => {
    expect(bloqueTieneRespuesta({ campos: { nit: { value: '900' } } })).toBe(true)
  })

  it('data vacio o nulo no cuenta', () => {
    expect(bloqueTieneRespuesta(null)).toBe(false)
    expect(bloqueTieneRespuesta(undefined)).toBe(false)
    expect(bloqueTieneRespuesta({})).toBe(false)
    expect(bloqueTieneRespuesta({ campos: {} })).toBe(false)
  })

  it('un campo vacio no es una respuesta', () => {
    expect(bloqueTieneRespuesta({ servicio: '' })).toBe(false)
    expect(bloqueTieneRespuesta({ servicio: null })).toBe(false)
  })

  it('las claves que escribe el motor no cuentan como respuesta', () => {
    // Un bloque que solo trae la firma de completado no fue contestado por nadie.
    expect(bloqueTieneRespuesta({ completado_por: 'uuid', completado_at: '2026-08-31' }))
      .toBe(false)
  })
})

describe('faltanRequisitos', () => {
  const requiere = [{ slug: 'servicio_contratado', label: 'Servicio contratado' }]

  it('sin requisitos declarados no falta nada', () => {
    expect(faltanRequisitos(null, new Map())).toEqual([])
    expect(faltanRequisitos([], new Map())).toEqual([])
  })

  it('un requisito respondido no falta', () => {
    const presentes = new Map([['servicio_contratado', { servicio: 'solo_iva' }]])
    expect(faltanRequisitos(requiere, presentes)).toEqual([])
  })

  it('un requisito sin sembrar en el negocio falta', () => {
    expect(faltanRequisitos(requiere, new Map())).toEqual(requiere)
  })

  it('un requisito sembrado pero vacio falta', () => {
    const presentes = new Map([['servicio_contratado', {}]])
    expect(faltanRequisitos(requiere, presentes)).toEqual(requiere)
  })

  it('nombra el label, y cae al slug si no lo hay', () => {
    expect(nombresDeRequisitos([{ slug: 'a', label: 'Bloque A' }, { slug: 'b' }]))
      .toBe('Bloque A, b')
  })
})
