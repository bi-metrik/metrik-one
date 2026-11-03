import { beforeAll, describe, expect, it, vi } from 'vitest'
import { extraerEntrante, textoLegible } from '../wa-webhook-payload'
import type { MetaWebhookPayload } from '../wa-webhook-payload'
import { claseDelEntrante, filaEntrante } from '../wa-conversacion'
import { primeraVezDelMensaje } from '../wa-mensaje-unico'
import { esConfirmacionDeRecordatorio, payloadConfirmacion } from '../wa-recordatorios-reglas'
import { atenderPendientes } from './cola'
import { escenario } from './escenario'
import { escenarioOne } from './one/escenario'
import { modeloGuionado } from './modelo-guionado'
import { componenteBotonPlantilla, leerToque, MAX_PAYLOAD_PLANTILLA, payloadPlantilla, PREFIJO_PLANTILLA } from './render'
import type { IncomingMessage } from '../types'

/**
 * El toque de un botón de plantilla llega al asistente (spec 2026-10-26, asistentes-roles-y-funciones §4.5).
 * El webhook ya lee `type: 'button'` (#966): `button.payload` llega en `interactive_reply` y `button.text` en `text`.
 * Lo nuevo es el prefijo de NUESTRAS plantillas, `ag|t|<plantilla>|<accion>`: el agente lo toma; lo demás (otra
 * plantilla, un payload sin prefijo, el `rec_ok` de los recordatorios de #966) sigue por el camino de siempre.
 */

vi.mock('../supabase-client.ts', () => ({ getServiceClient: () => { throw new Error('no se usa') } }))

type ModAgente = typeof import('../wa-agente')
let agente: ModAgente

beforeAll(async () => {
  ;(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: () => undefined } }
  agente = await import('../wa-agente.ts')
})

const PROPIO = '106540352242922'
const PAYLOAD = 'ag|t|jornada_v1|empezar'

/**
 * ARMADO DE LA DOC, no capturado de producción: el ejemplo de «Button messages webhook reference»
 * (https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/button),
 * con el payload y el texto de nuestra plantilla en vez de «Unsubscribe». Reemplazar por uno real cuando lo haya.
 */
function webhookBoton(payload: string, texto: string, wamid = 'wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA='): MetaWebhookPayload {
  return {
    entry: [{
      changes: [{
        value: {
          metadata: { display_phone_number: '15550783881', phone_number_id: PROPIO },
          contacts: [{ profile: { name: 'Sheena Nelson' }, wa_id: '16505551234' }],
          messages: [{
            context: { from: '15550783881', id: 'wamid.HBgLMTQxMjU1NTA4MjkVAgASGBQzQUNCNjk5RDUwNUZGMUZEM0VBRAA=' },
            from: '16505551234',
            id: wamid,
            timestamp: '1750091045',
            type: 'button',
            button: { payload, text: texto },
          }],
        },
      }],
    }],
  } as MetaWebhookPayload
}

function mensaje(payload: string, texto: string, wamid?: string): IncomingMessage {
  const e = extraerEntrante(webhookBoton(payload, texto, wamid), PROPIO)
  if (e?.tipo !== 'con_telefono') throw new Error('se esperaba un mensaje con teléfono')
  return e.mensaje
}

describe('el payload de Meta de una respuesta rápida (armado de la doc)', () => {
  it('llega como `button`, con el payload, el texto del botón y el wamid', () => {
    const m = mensaje(PAYLOAD, 'Empezar')
    expect(m.type).toBe('button')
    expect(m.interactive_reply).toBe(PAYLOAD)
    expect(m.text).toBe('Empezar')
    expect(m.wa_message_id).toBe('wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUFERjg0NDEzNDdFODU3MUMxMAA=')
    expect(textoLegible(webhookBoton(PAYLOAD, 'Empezar').entry![0].changes![0].value!.messages![0])).toBe('Empezar')
  })

  it('`claseDelEntrante` lo clasifica como `toque` y la fila guarda el payload y el texto', () => {
    const m = mensaje(PAYLOAD, 'Empezar')
    expect(claseDelEntrante(m)).toBe('toque')
    const f = filaEntrante({ workspace_id: 'w' }, m)
    expect(f).toMatchObject({ clase: 'toque', texto: 'Empezar', toque_id: PAYLOAD, wa_message_id: m.wa_message_id })
  })

  it('un reintento de Meta (mismo wamid) se procesa una sola vez', async () => {
    const claves = new Set<string>()
    const db = {
      from: () => ({
        insert: async (f: { clave: string }) => {
          if (claves.has(f.clave)) return { error: { code: '23505', message: 'duplicate key' } }
          claves.add(f.clave)
          return { error: null }
        },
      }),
    }
    const a = mensaje(PAYLOAD, 'Empezar')
    const b = mensaje(PAYLOAD, 'Empezar')
    expect(await primeraVezDelMensaje(db, a.wa_message_id)).toBe(true)
    expect(await primeraVezDelMensaje(db, b.wa_message_id)).toBe(false)
  })
})

describe('leerToque con el prefijo de plantilla', () => {
  it('`ag|t|<plantilla>|<accion>` → clase plantilla', () => {
    expect(leerToque(PAYLOAD)).toEqual({ clase: 'plantilla', plantilla: 'jornada_v1', accion: 'empezar' })
  })

  it('mal formado: no es del agente', () => {
    for (const p of ['ag|t|', 'ag|t|jornada_v1', 'ag|t|jornada_v1|', 'ag|t||empezar', 'ag|t|jornada_v1|empezar|x', 'ag|t|Jornada|empezar', 'ag|t|jornada v1|empezar']) {
      expect(leerToque(p)).toBeNull()
    }
  })

  it('las clases de antes no cambian', () => {
    expect(leerToque('ag|p|abc123|si')).toEqual({ clase: 'propuesta', huella: 'abc123', si: true })
    expect(leerToque('ag|c|abcd|2')).toEqual({ clase: 'conversacion' })
  })
})

describe('quién toma el toque', () => {
  it('`ag|t|…` lo toma el agente (bandeja y ONE)', () => {
    const m = mensaje(PAYLOAD, 'Empezar')
    expect(agente.fueraDelAgente(m)).toBe(false)
    expect(agente.fueraDelAgenteOne(m)).toBe(false)
  })

  it('sin prefijo (una plantilla mandada sin payload: Meta devuelve el texto del botón) sigue el camino de siempre', () => {
    for (const p of ['Unsubscribe', 'Empezar', 'jornada_v1|empezar', 'ag|t|Jornada|empezar']) {
      const m = mensaje(p, 'Empezar')
      expect(agente.fueraDelAgente(m)).toBe(true)
      expect(agente.fueraDelAgenteOne(m)).toBe(true)
    }
  })

  it('los recordatorios de #966 (`rec_ok`, `rec_ok:<id>`) siguen a #966 y el prefijo nuevo no los pisa', () => {
    const id = '6f1a2b3c-0000-4000-8000-000000000001'
    for (const p of ['rec_ok', payloadConfirmacion(id)]) {
      // El webhook los resuelve ANTES de `processMessage` con `esConfirmacionDeRecordatorio`.
      expect(esConfirmacionDeRecordatorio(p)).toBe(true)
      expect(leerToque(p)).toBeNull()
      expect(agente.fueraDelAgente(mensaje(p, 'Listo'))).toBe(true)
    }
    expect(esConfirmacionDeRecordatorio(PAYLOAD)).toBe(false)
  })
})

describe('entra al turno como un toque con su texto', () => {
  it('ONE: el modelo ve «[toque: "Empezar" · botón de la plantilla jornada_v1]» y decide', async () => {
    const modelo = modeloGuionado([{ name: 'responder', args: { tema: 'conversacion', texto: 'Listo, arrancamos.' } }])
    const e = await escenarioOne({ modelo })
    e.almacen.entrante({ workspaceId: e.deps.workspaceId, phone: e.deps.phone, clase: 'toque', texto: 'Empezar', toqueId: PAYLOAD })
    await atenderPendientes(e.deps)
    expect(modelo.pedidos).toHaveLength(1)
    expect(JSON.stringify(modelo.pedidos[0].mensajes)).toContain('[toque: \\"Empezar\\" · botón de la plantilla jornada_v1]')
    expect(e.mensajero.enviados.map((x) => x.salida)).toEqual([{ tipo: 'texto', texto: 'Listo, arrancamos.' }])
    expect(e.puerto.escrituras ?? []).toEqual([])
  })

  it('bandeja: lo mismo; sin texto del botón, la acción', async () => {
    const modelo = modeloGuionado([{ name: 'responder', args: { tema: 'viaje', texto: 'Dale.' } }])
    const e = await escenario({ modelo })
    e.almacen.entrante({ workspaceId: e.deps.workspaceId, phone: e.deps.phone, clase: 'toque', texto: null, toqueId: PAYLOAD })
    await atenderPendientes(e.deps)
    expect(modelo.pedidos.length).toBeGreaterThan(0)
    expect(JSON.stringify(modelo.pedidos[0].mensajes)).toContain('[toque: \\"empezar\\" · botón de la plantilla jornada_v1]')
    expect(e.puerto.escrituras).toEqual([])
  })
})

describe('el ayudante del payload', () => {
  it('arma `ag|t|<plantilla>|<accion>` y el componente del botón', () => {
    expect(payloadPlantilla('jornada_v1', 'empezar')).toBe(PAYLOAD)
    expect(payloadPlantilla('jornada_v1', 'empezar').startsWith(PREFIJO_PLANTILLA)).toBe(true)
    expect(componenteBotonPlantilla('jornada_v1', 'empezar', 1)).toEqual({
      type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: PAYLOAD }],
    })
    // Lo que arma lo lee el agente.
    expect(leerToque(payloadPlantilla('resumen_lunes', 'ver_detalle'))).toEqual({ clase: 'plantilla', plantilla: 'resumen_lunes', accion: 'ver_detalle' })
  })

  it('rechaza claves inválidas, índices fuera de 0..9 y lo que pasa del tope', () => {
    expect(() => payloadPlantilla('Jornada', 'empezar')).toThrow()
    expect(() => payloadPlantilla('jornada', 'em|pezar')).toThrow()
    expect(() => payloadPlantilla('', 'empezar')).toThrow()
    expect(() => componenteBotonPlantilla('jornada', 'empezar', 10)).toThrow()
    expect(MAX_PAYLOAD_PLANTILLA).toBe(256)
    const resto = MAX_PAYLOAD_PLANTILLA - PREFIJO_PLANTILLA.length - 'a|'.length
    expect(payloadPlantilla('a', 'x'.repeat(resto))).toHaveLength(MAX_PAYLOAD_PLANTILLA)
    expect(() => payloadPlantilla('a', 'x'.repeat(resto + 1))).toThrow(/máximo es 256/)
  })
})
