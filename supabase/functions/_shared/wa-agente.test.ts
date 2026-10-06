import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * El interruptor del núcleo conversacional en el webhook. Apagado = `main`: ni una consulta más.
 */

vi.mock('./supabase-client.ts', () => ({ getServiceClient: () => { throw new Error('no se usa') } }))

type Mod = typeof import('./wa-agente')
let mod: Mod

beforeAll(async () => {
  ;(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: () => undefined } }
  mod = await import('./wa-agente.ts')
})

const usuario = (bot: unknown) => ({
  workspace_id: 'w', phone: '573', name: 'Vale', role: 'operator' as const, subscription_status: 'trial',
  modulos: { modules: { bandeja_solicitudes_wa: true }, bot_conversacional: bot },
})
const msg = { phone: '573', text: 'hola', type: 'text' as const, timestamp: '1', wa_message_id: 'w1' }

function supabaseQueCuenta() {
  const llamadas: string[] = []
  const proxy: unknown = new Proxy(() => {}, {
    get: (_t, k) => { llamadas.push(String(k)); return proxy },
    apply: () => proxy,
  })
  return { supabase: proxy as never, llamadas }
}

describe('atenderConAgente', () => {
  it('apagado (ausente, híbrido o «true» en texto): devuelve false sin tocar la base', async () => {
    for (const bot of [undefined, null, { hibrido: true }, { agente: 'true' }, { agente: false }]) {
      const s = supabaseQueCuenta()
      expect(await mod.atenderConAgente(s.supabase, usuario(bot), msg)).toBe(false)
      expect(s.llamadas).toEqual([])
    }
  })

  it('prendido no toma «gasto …», ni los botones que no son suyos, ni los Flows', () => {
    expect(mod.fueraDelAgente({ type: 'text', text: 'gasto 20 mil taxi' })).toBe(true)
    expect(mod.fueraDelAgente({ type: 'text', text: 'gasto 20 mil', reenviado: true })).toBe(false)
    expect(mod.fueraDelAgente({ type: 'interactive', text: 'Acepto', interactive_reply: 'terminos:acepto:x' })).toBe(true)
    expect(mod.fueraDelAgente({ type: 'interactive', text: '✅ Cargar', interactive_reply: 'b|r|si|x|-' })).toBe(true)
    expect(mod.fueraDelAgente({ type: 'interactive', text: 'Sí, ábrelo', interactive_reply: 'ag|p|abc|si' })).toBe(false)
    expect(mod.fueraDelAgente({ type: 'interactive', text: 'Cel. …9444', interactive_reply: 'ag|c|t1|1' })).toBe(false)
    expect(mod.fueraDelAgente({ type: 'flow_response', text: '' })).toBe(true)
    expect(mod.fueraDelAgente({ type: 'text', text: 'abre un viaje nuevo' })).toBe(false)
  })

  it('prendido sin reglamento publicado: sigue el bot de siempre', async () => {
    const supabase = {
      from: () => {
        const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: null, error: null }) }
        return q
      },
    }
    const espia = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await mod.atenderConAgente(supabase as never, usuario({ agente: true }), msg)).toBe(false)
    expect(espia).toHaveBeenCalledWith(expect.stringContaining('sin reglamento publicado'))
    espia.mockRestore()
  })
})
