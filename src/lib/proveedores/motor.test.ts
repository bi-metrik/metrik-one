import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'

import { BYTES_MAXIMOS_CORRIDA, correrMotor, jsonDeRespuesta, MODELO_EXTRACCION } from './motor'

/**
 * El motor con un modelo SIMULADO (`MockLanguageModelV4`): ninguna prueba llama al modelo de verdad
 * ni gasta cuota. Proveedor ficticio.
 */
const HOY = '2026-10-19'

const EXTRACCION = {
  esquema_version: '0.3',
  expediente: { archivos: [{ archivo: 'tar0_Tarifas 2027.pdf', decision: 'usar' }], pedir_actualizacion: [] },
  tarifario: {
    moneda: 'COP',
    vigencia: { desde: null, hasta: null, texto: null, fuente: 'ninguna', requiere_confirmacion: true },
    tarifas: [{ categoria: 'Estándar', precio: 200000, moneda: 'COP' }],
  },
}

function modelo(texto: string, fin: 'stop' | 'length' = 'stop') {
  return new MockLanguageModelV4({
    modelId: 'modelo-simulado',
    doGenerate: async () => ({
      content: [{ type: 'text', text: texto }],
      finishReason: { unified: fin, raw: undefined },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 20, text: 20, reasoning: undefined } },
      warnings: [],
    }),
  })
}

const PDF = { nombre: 'tar0_Tarifas 2027.pdf', mime: 'application/pdf', datos: new Uint8Array([37, 80, 68, 70]) }

describe('motor de extracción', () => {
  it('usa Haiku por el gateway salvo que le pasen otro modelo', () => {
    expect(MODELO_EXTRACCION).toMatch(/^anthropic\/claude-haiku-/)
  })

  it('manda la instrucción y TODOS los archivos en una llamada, y revisa la salida', async () => {
    const m = modelo('```json\n' + JSON.stringify(EXTRACCION) + '\n```')
    const img = { nombre: 'tar1_Condiciones.png', mime: 'image/png', datos: new Uint8Array([1, 2, 3]) }
    const r = await correrMotor({ archivos: [PDF, img], instruccion: 'INSTRUCCIÓN DE PRUEBA', hoy: HOY, modelo: m })
    expect(r).toMatchObject({ ok: true, modelo: 'modelo-simulado', extraccion: { esquemaVersion: '0.3', avisos: ['Vigencia por confirmar al cargar.'] } })
    expect(m.doGenerateCalls).toHaveLength(1)
    const prompt = JSON.stringify(m.doGenerateCalls[0].prompt)
    expect(prompt).toContain('INSTRUCCIÓN DE PRUEBA')
    expect(prompt).toContain('tar0_Tarifas 2027.pdf')
    expect(prompt).toContain('tar1_Condiciones.png')
    const partes: { type?: string; mediaType?: string }[] = m.doGenerateCalls[0].prompt.flatMap((msg) => (Array.isArray(msg.content) ? (msg.content as { type?: string; mediaType?: string }[]) : []))
    expect(partes.filter((p) => p.type === 'file').map((p) => p.mediaType)).toEqual(['application/pdf', 'image/png'])
  })

  it('una salida con errores de la torre no pasa', async () => {
    const conCorreo = { ...EXTRACCION, tarifario: { ...EXTRACCION.tarifario, condiciones: { pago: 'reservas@ficticio.com' } } }
    const r = await correrMotor({ archivos: [PDF], instruccion: 'x', hoy: HOY, modelo: modelo(JSON.stringify(conCorreo)) })
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/correo/) })
  })

  it('una salida cortada o sin JSON no se guarda', async () => {
    expect(await correrMotor({ archivos: [PDF], instruccion: 'x', hoy: HOY, modelo: modelo('{"esquema_version": "0.3", "expe', 'length') })).toMatchObject({ ok: false, error: expect.stringMatching(/cortada/) })
    expect(await correrMotor({ archivos: [PDF], instruccion: 'x', hoy: HOY, modelo: modelo('No pude leer los archivos.') })).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) })
  })

  it('sin archivos o con demasiados bytes no llama al modelo', async () => {
    const m = modelo('{}')
    expect(await correrMotor({ archivos: [], instruccion: 'x', hoy: HOY, modelo: m })).toMatchObject({ ok: false })
    const grande = { ...PDF, datos: new Uint8Array(BYTES_MAXIMOS_CORRIDA + 1) }
    expect(await correrMotor({ archivos: [grande], instruccion: 'x', hoy: HOY, modelo: m })).toMatchObject({ ok: false, error: expect.stringMatching(/MB/) })
    expect(m.doGenerateCalls).toHaveLength(0)
  })

  it('si el modelo falla, un error en llano', async () => {
    const m = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('gateway caído') } })
    expect(await correrMotor({ archivos: [PDF], instruccion: 'x', hoy: HOY, modelo: m })).toEqual({ ok: false, error: 'El motor no respondió. Vuelve a intentarlo en un rato.' })
  })

  it('saca el JSON de la respuesta', () => {
    expect(jsonDeRespuesta('Aquí va:\n```json\n{"a": {"b": 1}}\n```\nListo.')).toBe('{"a": {"b": 1}}')
    expect(jsonDeRespuesta('sin json')).toBeNull()
  })
})
