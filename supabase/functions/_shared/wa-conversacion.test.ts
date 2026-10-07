import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claseDelEntrante,
  completarTexto,
  conversacionActiva,
  filaEntrante,
  registrarEntrante,
  registrarSaliente,
  salienteDelPayload,
} from './wa-conversacion'
import type { IncomingMessage, WaUser } from './types'

/**
 * La conversación completa (`wa_conversacion`). La lógica SQL (24 h, workspace del último entrante, dedupe por wamid)
 * se prueba con PGlite en `src/lib/bandeja-wa/conversacion-sql.test.ts`; aquí, lo que arma el código y que nunca lanza.
 */

const WS = '00000000-0000-4000-8000-0000000000a1'
const usuario = (modulos: WaUser['modulos']): WaUser => ({
  workspace_id: WS, phone: '573001112233', name: 'Vale', role: 'operator', subscription_status: 'trial', modulos,
})
const BANDEJA = usuario({ modules: { bandeja_solicitudes_wa: true } })
const msg = (m: Partial<IncomingMessage>): IncomingMessage => ({ phone: '573001112233', text: '', type: 'text', timestamp: '1', ...m })

function clienteFalso(respuesta: { error: unknown } = { error: null }) {
  const inserts: Array<Record<string, unknown>> = []
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = []
  const updates: Array<{ valores: Record<string, unknown>; filtros: unknown[] }> = []
  const cliente = {
    from: (_t: string) => ({
      insert: async (fila: Record<string, unknown>) => { inserts.push(fila); return respuesta },
      update: (valores: Record<string, unknown>) => {
        const u = { valores, filtros: [] as unknown[] }
        updates.push(u)
        const cadena = {
          eq: (c: string, v: unknown) => { u.filtros.push(['eq', c, v]); return cadena },
          is: (c: string, v: unknown) => { u.filtros.push(['is', c, v]); return Promise.resolve(respuesta) },
        }
        return cadena
      },
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return respuesta },
  }
  return { cliente, inserts, rpcs, updates }
}

describe('conversacionActiva: solo bandeja o bot conversacional configurado', () => {
  it('bandeja encendida', () => expect(conversacionActiva(BANDEJA)).toBe(true))
  it('bot conversacional configurado, aunque esté apagado', () => {
    expect(conversacionActiva(usuario({ modules: {}, bot_conversacional: { hibrido: false } }))).toBe(true)
  })
  it('sin ninguno de los dos (gastos de siempre): no se guarda', () => {
    expect(conversacionActiva(usuario({ modules: { business: true } }))).toBe(false)
    expect(conversacionActiva(usuario({ modules: { bandeja_solicitudes_wa: 'true' } }))).toBe(false)
    expect(conversacionActiva(usuario({ modules: {}, bot_conversacional: true }))).toBe(false)
    expect(conversacionActiva(usuario(null))).toBe(false)
  })
})

describe('claseDelEntrante', () => {
  it('reenvío gana a todo', () => {
    expect(claseDelEntrante({ type: 'text', reenviado: true })).toBe('reenvio')
    expect(claseDelEntrante({ type: 'audio', reenviado: true })).toBe('reenvio')
  })
  it('cada tipo', () => {
    expect(claseDelEntrante({ type: 'text' })).toBe('escrito')
    expect(claseDelEntrante({ type: 'interactive' })).toBe('toque')
    expect(claseDelEntrante({ type: 'button' })).toBe('toque')
    expect(claseDelEntrante({ type: 'audio' })).toBe('audio')
    expect(claseDelEntrante({ type: 'image' })).toBe('imagen')
    expect(claseDelEntrante({ type: 'location' })).toBe('ubicacion')
    expect(claseDelEntrante({ type: 'flow_response' })).toBe('otro')
  })
})

describe('filaEntrante', () => {
  it('un escrito largo se guarda COMPLETO (no 100 ni 300 caracteres)', () => {
    const largo = 'a'.repeat(1500)
    const f = filaEntrante(BANDEJA, msg({ text: largo, wa_message_id: 'wamid.1', phone: '+57 300 111 2233' }))
    expect(f).toMatchObject({ workspace_id: WS, phone: '573001112233', direccion: 'entrante', clase: 'escrito', wa_message_id: 'wamid.1' })
    expect((f.texto as string).length).toBe(1500)
  })
  it('un toque guarda su id, su título y el mensaje que tenía el botón', () => {
    const f = filaEntrante(BANDEJA, msg({
      type: 'interactive', text: 'Sí, ábrelo', interactive_reply: 't1|abc|si', wa_message_id: 'wamid.2',
      meta_mensaje: { context: { id: 'wamid.del-boton' } },
    }))
    expect(f).toMatchObject({ clase: 'toque', texto: 'Sí, ábrelo', toque_id: 't1|abc|si', contexto_wamid: 'wamid.del-boton' })
  })
  it('un audio llega sin texto y con su medio', () => {
    const f = filaEntrante(BANDEJA, msg({ type: 'audio', audio_id: 'media-9', wa_message_id: 'wamid.3' }))
    expect(f).toMatchObject({ clase: 'audio', texto: null, media: { tipo: 'audio', id: 'media-9' }, toque_id: null })
  })
  it('una ubicación queda legible', () => {
    const f = filaEntrante(BANDEJA, msg({ type: 'location', location: { latitude: 1, longitude: 2, name: 'Hotel' } }))
    expect(f.texto).toBe('[ubicación] Hotel')
  })
})

describe('registrarEntrante', () => {
  it('fuera de la bandeja no hace ni una consulta', async () => {
    const f = clienteFalso()
    expect(await registrarEntrante(f.cliente, usuario({ modules: {} }), msg({ text: 'hola' }))).toBe(false)
    expect(f.inserts).toHaveLength(0)
  })
  it('con la bandeja inserta la fila', async () => {
    const f = clienteFalso()
    expect(await registrarEntrante(f.cliente, BANDEJA, msg({ text: 'hola', wa_message_id: 'w' }))).toBe(true)
    expect(f.inserts).toHaveLength(1)
  })
  it('un duplicado de Meta (23505) no es error y no lanza', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = clienteFalso({ error: { code: '23505', message: 'dup' } })
    expect(await registrarEntrante(f.cliente, BANDEJA, msg({ text: 'hola', wa_message_id: 'w' }))).toBe(false)
    expect(espia).not.toHaveBeenCalled()
    espia.mockRestore()
  })
  it('la base revienta: no lanza', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cliente = { from: () => { throw new Error('caida') }, rpc: async () => ({ error: null }) }
    await expect(registrarEntrante(cliente, BANDEJA, msg({ text: 'x' }))).resolves.toBe(false)
    espia.mockRestore()
  })
})

describe('completarTexto: la transcripción completa el renglón del audio', () => {
  it('solo si el texto seguía vacío', async () => {
    const f = clienteFalso()
    await completarTexto(f.cliente, 'wamid.3', 'quiero ir a San Andrés')
    expect(f.updates[0]).toEqual({ valores: { texto: 'quiero ir a San Andrés' }, filtros: [['eq', 'wa_message_id', 'wamid.3'], ['is', 'texto', null]] })
  })
  it('sin wamid o sin texto no consulta', async () => {
    const f = clienteFalso()
    await completarTexto(f.cliente, undefined, 'x')
    await completarTexto(f.cliente, 'w', '  ')
    expect(f.updates).toHaveLength(0)
  })
})

describe('salienteDelPayload: lo que el usuario vio', () => {
  it('texto completo', () => {
    const t = 'b'.repeat(900)
    expect(salienteDelPayload({ type: 'text', text: { body: t } })).toEqual({ texto: t, formato: 'texto', opciones: null })
  })
  it('botones con sus opciones en orden', () => {
    const s = salienteDelPayload({
      type: 'interactive',
      interactive: { type: 'button', body: { text: '¿Abro este viaje?' }, action: { buttons: [
        { type: 'reply', reply: { id: 'a|h|si', title: 'Sí, ábrelo' } },
        { type: 'reply', reply: { id: 'a|h|no', title: 'No' } },
      ] } },
    })
    expect(s).toEqual({ texto: '¿Abro este viaje?', formato: 'botones', opciones: [{ id: 'a|h|si', titulo: 'Sí, ábrelo' }, { id: 'a|h|no', titulo: 'No' }] })
  })
  it('lista con descripción', () => {
    const s = salienteDelPayload({
      type: 'interactive',
      interactive: { type: 'list', body: { text: '¿Cuál?' }, action: { button: 'Ver', sections: [{ rows: [{ id: 'r1', title: 'M1 26 1', description: 'Cartagena' }, { id: 'r2', title: 'Viaje nuevo' }] }] } },
    })
    expect(s.formato).toBe('lista')
    expect(s.opciones).toEqual([{ id: 'r1', titulo: 'M1 26 1', descripcion: 'Cartagena' }, { id: 'r2', titulo: 'Viaje nuevo' }])
  })
  it('un envío con secreto guarda el preview y NUNCA el texto real', () => {
    const s = salienteDelPayload({ type: 'text', text: { body: 'tu llave: sk_live_123' } }, 'Llave enviada')
    expect(s.texto).toBe('Llave enviada')
    expect(JSON.stringify(s)).not.toContain('sk_live_123')
  })
  it('plantilla y documento', () => {
    expect(salienteDelPayload({ type: 'template', template: { name: 'aviso' } })).toMatchObject({ texto: '[plantilla aviso]', formato: 'plantilla' })
    expect(salienteDelPayload({ type: 'document', document: { filename: 'a.pdf', caption: 'tu contrato' } })).toMatchObject({ texto: '[documento] a.pdf\ntu contrato', formato: 'documento' })
  })
})

describe('registrarSaliente', () => {
  it('llama la RPC con el texto completo y las opciones', async () => {
    const f = clienteFalso()
    await registrarSaliente(f.cliente, '573001112233', 'wamid.out', { type: 'text', text: { body: 'hola' } }, { origen: 'bot', intent: 'bandeja' })
    expect(f.rpcs).toEqual([{ fn: 'wa_conversacion_registrar_saliente', args: {
      p_phone: '573001112233', p_wa_message_id: 'wamid.out', p_texto: 'hola', p_formato: 'texto', p_opciones: null, p_origen: 'bot', p_intent: 'bandeja',
    } }])
  })
  it('sin la migración aplicada (PGRST202) se calla', async () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = clienteFalso({ error: { code: 'PGRST202', message: 'no existe' } })
    await registrarSaliente(f.cliente, '5730', 'w', { type: 'text', text: { body: 'x' } })
    expect(espia).not.toHaveBeenCalled()
    espia.mockRestore()
  })
})

// ------------------------------------------------------------
// postMessage: TODO envío deja su fila en la conversación, en paralelo con `wa_envios`
// ------------------------------------------------------------

const rpcEnvio = vi.fn(async () => ({ error: null }))
const insertEnvio = vi.fn(async () => ({ error: null }))
vi.mock('./supabase-client.ts', () => ({
  getServiceClient: () => ({ from: () => ({ insert: insertEnvio }), rpc: rpcEnvio }),
}))

describe('wa-respond: el envío se registra en la conversación', () => {
  beforeEach(() => {
    ;(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: () => 'x' } }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.salio' }] }), { status: 200 })))
    rpcEnvio.mockClear()
    insertEnvio.mockClear()
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('botones: la RPC recibe el cuerpo, el formato y las opciones', async () => {
    const { sendButtons } = await import('./wa-respond.ts')
    await sendButtons('573001112233', '¿Abro este viaje?', [{ id: 'x|h|si', title: 'Sí, ábrelo' }, { id: 'x|h|no', title: 'No' }], { intent: 'agente' })
    expect(insertEnvio).toHaveBeenCalledTimes(1)
    expect(rpcEnvio).toHaveBeenCalledWith('wa_conversacion_registrar_saliente', expect.objectContaining({
      p_wa_message_id: 'wamid.salio', p_texto: '¿Abro este viaje?', p_formato: 'botones',
      p_opciones: [{ id: 'x|h|si', titulo: 'Sí, ábrelo' }, { id: 'x|h|no', titulo: 'No' }], p_intent: 'agente',
    }))
  })

  it('un envío que Meta rechaza no entra a la conversación (el usuario no lo vio)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{}}', { status: 400 })))
    const espia = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sendTextMessage } = await import('./wa-respond.ts')
    await sendTextMessage('573001112233', 'hola')
    expect(insertEnvio).toHaveBeenCalledTimes(1)
    expect(rpcEnvio).not.toHaveBeenCalled()
    espia.mockRestore()
  })
})
