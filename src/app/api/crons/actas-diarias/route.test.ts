/**
 * La guarda de llaves de `/api/crons/actas-diarias` (Mauricio, 2026-11-06): con las actas en Claude Haiku no exige
 * GEMINI_API_KEY (avisa que no hay respaldo); con las actas en Gemini la sigue exigiendo; sin ninguna llave, 503.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const leidas: Date[] = []
vi.mock('@/lib/idempotencia/candado-cron', () => ({ candadoDeCron: async () => null }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/actas/seleccion', () => ({
  seleccionarDelDia: async (f: Date) => {
    leidas.push(f)
    return { revisadas: 0, candidatas: [], descartadas: [] }
  },
}))
vi.mock('@/lib/actas/envio', () => ({
  enviarActa: async () => ({ success: true }),
  fechaReunionISO: () => '',
  MODO_ENVIO_DEFAULT: 'borrador',
}))

const { GET } = await import('./route')

const pedir = () =>
  GET(new NextRequest('https://x.metrikone.co/api/crons/actas-diarias', { headers: { authorization: 'Bearer s3creto' } }))

beforeEach(() => {
  leidas.length = 0
  vi.stubEnv('CRON_SECRET', 's3creto')
  vi.stubEnv('LLM_PROVEEDOR', '')
  vi.stubEnv('LLM_PROVEEDOR_ACTAS', '')
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  vi.stubEnv('GEMINI_API_KEY', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('la llave que exige el cron de actas', () => {
  it('Haiku con ANTHROPIC_API_KEY y sin GEMINI_API_KEY: corre, con aviso de que no hay respaldo', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await pedir()
    expect(r.status).toBe(200)
    expect(leidas).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('sin respaldo en Gemini'))
  })

  it('con las dos llaves: corre y no avisa', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk')
    vi.stubEnv('GEMINI_API_KEY', 'g')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await pedir()).status).toBe(200)
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([['LLM_PROVEEDOR_ACTAS'], ['LLM_PROVEEDOR']])(
    '%s=gemini sin GEMINI_API_KEY: 503 aunque haya llave de Anthropic',
    async (v) => {
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk')
      vi.stubEnv(v, 'gemini')
      const r = await pedir()
      expect(r.status).toBe(503)
      expect((await r.json()).error).toMatch(/GEMINI_API_KEY no configurada.*van a Gemini/)
      expect(leidas).toHaveLength(0)
    },
  )

  it('en Gemini con su llave: corre como siempre', async () => {
    vi.stubEnv('LLM_PROVEEDOR_ACTAS', 'gemini')
    vi.stubEnv('GEMINI_API_KEY', 'g')
    expect((await pedir()).status).toBe(200)
  })

  it('sin ninguna llave: 503 que nombra las dos y no lee el calendario', async () => {
    const r = await pedir()
    expect(r.status).toBe(503)
    expect((await r.json()).error).toMatch(/falta ANTHROPIC_API_KEY.*GEMINI_API_KEY/)
    expect(leidas).toHaveLength(0)
  })
})
