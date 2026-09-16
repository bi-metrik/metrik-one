/**
 * Dos server actions registradas que no pedian sesion y leian con credenciales globales.
 *
 * Hallazgo de la segunda ronda del riesgo 11, barriendo el manifiesto de server actions
 * del build (no estaban en la lista del encargo):
 *   - `consultarEpayco(refPayco)` consulta la cuenta de ePayco de las variables de entorno
 *     y devuelve el desglose de la transaccion, con el nombre del pagador y los montos.
 *     Las referencias son numericas: sin sesion se podian recorrer.
 *   - `listarConsultas()` de `valida.ts` lista las ultimas consultas SARLAFT hechas con la
 *     llave global de Valida: nombres y documentos consultados.
 *
 * Lo que se fija aqui: sin sesion ninguna de las dos sale a la red; con sesion, si.
 *
 * VISTO FALLAR (2026-09-16) contra `epayco-actions.ts` y `valida.ts` de `origin/main`:
 * caen los 2 casos sin sesion; los 2 con sesion siguen verdes. Quitando cada guarda del
 * archivo nuevo cae 1 caso por guarda.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const sesion: { workspaceId: string | null } = { workspaceId: null }

const consultarTransaccionEpayco = vi.fn(async (_ref: number) => ({ estado: 'Rechazada' }))
const fetchValida = vi.fn(async (_url: unknown, _init?: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ consultas: [] }),
}))

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: {},
    workspaceId: sesion.workspaceId,
    error: sesion.workspaceId ? null : 'No autenticado',
  }),
}))
vi.mock('@/lib/epayco', () => ({
  consultarTransaccionEpayco: (ref: number) => consultarTransaccionEpayco(ref),
}))
vi.mock('@/lib/siigo/recibo-automatico', () => ({ emitirReciboAutomatico: async () => null }))
vi.mock('@/lib/cobros/aviso-sobrepago-servidor', () => ({ avisarSobrepagoSiCorresponde: async () => null }))

import { consultarEpayco } from './epayco-actions'
import { listarConsultas } from './valida'

beforeEach(() => {
  sesion.workspaceId = null
  consultarTransaccionEpayco.mockClear()
  fetchValida.mockClear()
  vi.stubGlobal('fetch', fetchValida)
  process.env.VALIDA_API_KEY = 'llave-global-de-prueba'
})

describe('consultarEpayco', () => {
  it('sin sesion no consulta ePayco', async () => {
    const r = await consultarEpayco('123456')
    expect(r).toEqual({ success: false, error: 'No autenticado' })
    expect(consultarTransaccionEpayco).not.toHaveBeenCalled()
  })

  it('con sesion consulta', async () => {
    sesion.workspaceId = 'ws-1'
    await consultarEpayco('123456')
    expect(consultarTransaccionEpayco).toHaveBeenCalledWith(123456)
  })
})

describe('listarConsultas (Valida con la llave global)', () => {
  it('sin sesion no llama a Valida', async () => {
    const r = await listarConsultas()
    expect(r.ok).toBe(false)
    expect(fetchValida).not.toHaveBeenCalled()
  })

  it('con sesion llama', async () => {
    sesion.workspaceId = 'ws-1'
    const r = await listarConsultas()
    expect(r.ok).toBe(true)
    expect(fetchValida).toHaveBeenCalledTimes(1)
  })
})
