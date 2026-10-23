import { describe, expect, it } from 'vitest'
import type { ValidaResultado } from '@/lib/actions/valida-consultas'
import {
  claveIdempotenciaReproceso,
  ejecutarReproceso,
  ensayarReproceso,
  moverConteo,
  planReproceso,
  TIPOS_ACEPTADOS_ANTES,
  type ConsultaEnError,
  type RespuestaReproceso,
} from './reproceso-tipo-documento'

// Datos inventados: ningún nombre ni documento real.
const consulta = (id: string, documento_tipo: string, extra: Partial<ConsultaEnError> = {}): ConsultaEnError => ({
  id,
  tipo_persona: 'natural',
  nombre_consultado: 'Persona De Prueba',
  documento_tipo,
  documento_numero: '10000001',
  negocio_id: null,
  lote_fila_id: null,
  ...extra,
})

const resultado = (severidad: ValidaResultado['severidad'], id = 'val-1'): ValidaResultado => ({
  consulta_id: id,
  severidad,
  total_matches: severidad === 'sin_hallazgo' ? 0 : 1,
  matches: [],
  hash_reporte: `h-${id}`,
  fecha_reporte: '2026-10-24T10:00:00Z',
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
})

describe('corrida del reproceso', () => {
  function dobles(respuestas: Record<string, RespuestaReproceso>) {
    const llamadas: Array<{ clave: string; tipo: string | undefined }> = []
    const escritas = new Map<string, Record<string, unknown>>()
    const lotes: string[] = []
    return {
      llamadas,
      escritas,
      lotes,
      deps: {
        llamar: async (input: { documento?: { tipo: string } }, clave: string) => {
          llamadas.push({ clave, tipo: input.documento?.tipo })
          return respuestas[clave] ?? { ok: true as const, data: resultado('sin_hallazgo') }
        },
        actualizarConsulta: async (id: string, cambios: Record<string, unknown>) => {
          if (escritas.has(id)) return false
          escritas.set(id, cambios)
          return true
        },
        actualizarFilaLote: async (loteFilaId: string) => {
          lotes.push(loteFilaId)
        },
        ahora: () => new Date('2026-10-24T10:00:00Z'),
      },
    }
  }

  it('actualiza la misma fila con resultado, constancia y tipo normalizado; reporta los hallazgos', async () => {
    const d = dobles({ [claveIdempotenciaReproceso('b')]: { ok: true, data: resultado('alto', 'val-b') } })
    const r = await ejecutarReproceso(
      [consulta('a', 'CEDULA', { negocio_id: 'neg-1' }), consulta('b', 'PP', { lote_fila_id: 'fila-1' }), consulta('c', 'TI'), consulta('d', 'X')],
      d.deps,
    )
    expect(d.llamadas).toEqual([
      { clave: 'one-reproceso-tipo-a', tipo: 'CC' },
      { clave: 'one-reproceso-tipo-b', tipo: 'PAS' },
      { clave: 'one-reproceso-tipo-c', tipo: 'TI' },
    ])
    expect(d.escritas.get('b')).toEqual({
      documento_tipo: 'PAS',
      severidad: 'alto',
      total_matches: 1,
      matches: [],
      valida_consulta_id: 'val-b',
      hash_reporte: 'h-val-b',
      reprocesada_at: '2026-10-24T10:00:00.000Z',
      reproceso: {
        motivo: 'tipo_documento',
        tipo_original: 'PP',
        tipo_inferido: false,
        severidad_anterior: 'error',
        fecha_reporte: '2026-10-24T10:00:00Z',
      },
    })
    expect(d.lotes).toEqual(['fila-1'])
    expect(r).toEqual({
      revisadas: 4,
      reprocesadas: 3,
      siguenEnError: 0,
      aparte: ['d'],
      conHallazgo: ['b'],
      negocios: 1,
      detenido: null,
    })
  })

  it('un error de Valida deja la fila como estaba; 402 detiene la corrida', async () => {
    const d = dobles({
      [claveIdempotenciaReproceso('a')]: { ok: false, error: 'valida_tiempo_agotado' },
      [claveIdempotenciaReproceso('b')]: { ok: false, error: 'bolsa_agotada', status: 402 },
    })
    const r = await ejecutarReproceso([consulta('a', 'CEDULA'), consulta('b', 'CEDULA'), consulta('c', 'CEDULA')], d.deps)
    expect(d.escritas.size).toBe(0)
    expect(d.llamadas).toHaveLength(2)
    expect(r).toMatchObject({ reprocesadas: 0, siguenEnError: 2, detenido: 'bolsa_agotada' })
  })

  it('el conteo del lote pasa la fila de error a su severidad', () => {
    expect(moverConteo({ error: 2, sin_hallazgo: 1 }, 'alto')).toEqual({ error: 1, sin_hallazgo: 1, alto: 1 })
    expect(moverConteo({ error: 1 }, 'sin_hallazgo')).toEqual({ sin_hallazgo: 1 })
  })
})
