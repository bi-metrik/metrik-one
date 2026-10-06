/**
 * Mientras un documento se lee, el avance de etapa espera (`cambiarEtapaNegocioConGate`).
 *
 * Mutación vista fallar (2026-10-05): sin el filtro de vigencia → 1 roja (la vencida
 * frenaría para siempre).
 */
import { describe, it, expect } from 'vitest'
import { documentosLeyendo, mensajeDocumentoLeyendo } from './documentos-leyendo'
import { LECTURA_VENCE_MS } from '@/lib/documentos/lectura-en-curso'

const AHORA = Date.parse('2026-10-05T15:30:00.000Z')
const hace = (ms: number) => new Date(AHORA - ms).toISOString()

function doble(filas: unknown[], error: unknown = null) {
  const filtros: Record<string, unknown> = {}
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { filtros[c] = v; return q },
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: error ? null : filas, error, filtros }).then(ok),
  }
  return { from: () => q, filtros }
}

const marca = (iniciada_at: string) => ({ _lectura: { token: 't', estado: 'leyendo', tipo: 'carga', iniciada_at } })

describe('documentosLeyendo', () => {
  it('nombra los documentos con lectura vigente', async () => {
    const sb = doble([{ data: marca(hace(5_000)), bloque_configs: { nombre: 'RUT' } }])
    expect(await documentosLeyendo(sb, 'neg-1', AHORA)).toEqual(['RUT'])
    expect(sb.filtros).toMatchObject({ negocio_id: 'neg-1', 'data->_lectura->>estado': 'leyendo' })
  })

  it('una lectura vencida ya no frena: la función murió y el negocio no puede quedar varado', async () => {
    const sb = doble([{ data: marca(hace(LECTURA_VENCE_MS + 1)), bloque_configs: { nombre: 'RUT' } }])
    expect(await documentosLeyendo(sb, 'neg-1', AHORA)).toEqual([])
  })

  it('una consulta caída no frena', async () => {
    expect(await documentosLeyendo(doble([], { message: 'timeout' }), 'neg-1', AHORA)).toEqual([])
  })

  it('el mensaje dice qué documento y qué esperar', () => {
    expect(mensajeDocumentoLeyendo('RUT')).toBe('RUT: el documento se está leyendo. Espera a que termine para avanzar.')
  })
})
