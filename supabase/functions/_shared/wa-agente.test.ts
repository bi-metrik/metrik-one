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

  // Prendido y dejando pasar: el núcleo empieza buscando el reglamento publicado (aquí no hay → sigue el bot de hoy).
  // Que llegue a esa consulta es la prueba de que el remitente entró al núcleo.
  async function entra(bot: unknown, phone: string): Promise<{ resultado: boolean; consultas: string[] }> {
    const consultas: string[] = []
    const supabase = {
      from: (t: string) => {
        consultas.push(t)
        const q = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: null, error: null }) }
        return q
      },
    }
    const espia = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const resultado = await mod.atenderConAgente(supabase as never, usuario(bot), { ...msg, phone })
    espia.mockRestore()
    return { resultado, consultas }
  }

  it('prendido con lista: un teléfono que NO está sigue el camino de hoy sin una sola consulta', async () => {
    const r = await entra({ agente: true, hibrido: true, agente_telefonos: ['573209219444'] }, '573001112233')
    expect(r).toEqual({ resultado: false, consultas: [] })
  })

  it('prendido con lista: el teléfono que SÍ está entra al núcleo (con o sin «+» y espacios en la lista)', async () => {
    expect((await entra({ agente: true, agente_telefonos: ['573209219444'] }, '573209219444')).consultas).toEqual(['bot_reglamentos'])
    expect((await entra({ agente: true, agente_telefonos: ['+57 320 921 9444'] }, '573209219444')).consultas).toEqual(['bot_reglamentos'])
  })

  it('prendido con lista vacía: nadie entra', async () => {
    expect(await entra({ agente: true, agente_telefonos: [] }, '573209219444')).toEqual({ resultado: false, consultas: [] })
  })

  it('prendido sin lista: entra todo el workspace', async () => {
    expect((await entra({ agente: true }, '573001112233')).consultas).toEqual(['bot_reglamentos'])
    expect((await entra({ agente: true }, '573209219444')).consultas).toEqual(['bot_reglamentos'])
  })

  it('apagado con lista: nadie entra, aunque esté en la lista', async () => {
    expect(await entra({ agente: false, agente_telefonos: ['573209219444'] }, '573209219444')).toEqual({ resultado: false, consultas: [] })
  })

  it('la traza de la carga cabe en el CHECK de 280 de activity_log', async () => {
    const { cortarContenido } = await import('./agente/produccion.ts')
    expect(cortarContenido('a'.repeat(279))).toBe('a'.repeat(279))
    const largo = cortarContenido('ñ'.repeat(500))
    expect([...largo].length).toBe(280)
    expect(largo.endsWith('…')).toBe(true)
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
