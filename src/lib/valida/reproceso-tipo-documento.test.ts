import { describe, expect, it } from 'vitest'
import { ensayarReproceso, esHallazgo, planReproceso, TIPOS_ACEPTADOS_ANTES, type ConsultaEnError } from './reproceso-tipo-documento'

// Datos inventados: ningún nombre ni documento real.
const consulta = (id: string, documento_tipo: string, extra: Partial<ConsultaEnError> = {}): ConsultaEnError => ({
  id,
  tipo_persona: 'natural',
  nombre_consultado: 'Persona De Prueba',
  documento_tipo,
  documento_numero: '10000001',
  ...extra,
})

describe('plan del reproceso', () => {
  it('CEDULA, CÉDULA, PP y PA se normalizan con la función del lote', () => {
    expect(planReproceso(consulta('a', 'CEDULA'))).toMatchObject({ accion: 'reprocesar', tipo: 'CC', inferido: false })
    expect(planReproceso(consulta('b', 'CÉDULA'))).toMatchObject({ accion: 'reprocesar', tipo: 'CC' })
    expect(planReproceso(consulta('c', 'PP', { documento_numero: 'AB123456' }))).toMatchObject({ accion: 'reprocesar', tipo: 'PAS' })
    expect(planReproceso(consulta('d', 'PA'))).toMatchObject({ accion: 'reprocesar', tipo: 'PAS' })
  })

  it('el cuerpo es el del lote: tipo de persona, nombre y documento, sin sujeto obligado', () => {
    const p = planReproceso(consulta('a', 'CEDULA'))
    expect(p.accion === 'reprocesar' && p.input).toEqual({
      tipo: 'natural',
      nombre: 'Persona De Prueba',
      documento: { tipo: 'CC', numero: '10000001' },
    })
  })

  it('TI, PPT y RC se reprocesan con su código (metrik-valida#70)', () => {
    expect(planReproceso(consulta('a', 'TI'))).toMatchObject({ accion: 'reprocesar', tipo: 'TI', inferido: false })
    expect(planReproceso(consulta('b', 'PPT'))).toMatchObject({ accion: 'reprocesar', tipo: 'PPT' })
    expect(planReproceso(consulta('c', 'RC'))).toMatchObject({ accion: 'reprocesar', tipo: 'RC' })
  })

  it('el filtro de la base es la lista de ANTES de #70: una fila en error con TI sí es de este reproceso', () => {
    expect(TIPOS_ACEPTADOS_ANTES).toEqual(['CC', 'CE', 'NIT', 'PAS'])
  })

  it('X o un NIT en la columna: jurídica se deduce NIT; natural va aparte', () => {
    expect(planReproceso(consulta('a', '900000001', { tipo_persona: 'juridica', documento_numero: '900000001' }))).toMatchObject({
      accion: 'reprocesar',
      tipo: 'NIT',
      inferido: true,
    })
    expect(planReproceso(consulta('b', 'X', { tipo_persona: 'juridica', documento_numero: '900000001' }))).toMatchObject({ tipo: 'NIT' })
    expect(planReproceso(consulta('c', 'X'))).toEqual({ accion: 'aparte', motivo: 'tipo_no_deducible' })
    expect(planReproceso(consulta('d', '900000001'))).toEqual({ accion: 'aparte', motivo: 'tipo_no_deducible' })
    expect(planReproceso(consulta('e', 'CEDULA', { documento_numero: null }))).toEqual({ accion: 'aparte', motivo: 'sin_numero' })
  })

  it('el ensayo solo clasifica ids', () => {
    expect(ensayarReproceso([consulta('a', 'CEDULA'), consulta('b', 'TI'), consulta('c', 'X')])).toEqual({
      reprocesar: ['a', 'b'],
      aparte: ['c'],
    })
  })

  it('hallazgo es alto, medio o bajo; informativo y sin hallazgo no', () => {
    expect(['alto', 'medio', 'bajo'].every(esHallazgo)).toBe(true)
    expect(['informativo', 'sin_hallazgo', 'error'].some(esHallazgo)).toBe(false)
  })
})
