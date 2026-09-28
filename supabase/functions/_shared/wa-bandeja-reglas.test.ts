/**
 * Bandeja de solicitudes por WhatsApp: a dónde va cada mensaje y qué se le contesta.
 *
 * El agrupamiento y la deduplicación los decide la base (ver `src/lib/bandeja-wa/bandeja-sql.test.ts`,
 * que corre la migración en PGlite). Aquí va lo que decide el código: la ruta, la palabra de
 * cierre, la lectura del reenvío en el payload de Meta y el cableado en `wa-webhook/index.ts`,
 * que no se puede importar desde node (lee `Deno.env` al cargarse) y por eso se lee el fuente.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MODULOS } from '@/lib/modulos/catalogo'
import {
  CONFIG_BANDEJA_POR_DEFECTO,
  LLAVE_BANDEJA,
  cuerpoDelMensaje,
  decidirRuta,
  esPalabraCierre,
  fechaDeMeta,
  leerConfigBandeja,
  respuestaTrasRegistro,
  textoPreguntaCliente,
} from './wa-bandeja-reglas'
import type { EntradaRuta } from './wa-bandeja-reglas'
import { extraerEntrante } from './wa-webhook-payload'

const ENCENDIDA = { business: true, [LLAVE_BANDEJA]: true }
const APAGADA = { business: true }

function entrada(p: Partial<EntradaRuta>): EntradaRuta {
  return {
    modules: ENCENDIDA,
    config: CONFIG_BANDEJA_POR_DEFECTO,
    tipo: 'text',
    texto: 'Hola, quiero cotizar un viaje a Cartagena para 4',
    reenviado: false,
    sesionBotEsperando: false,
    ...p,
  }
}

describe('decidirRuta', () => {
  it('con la bandeja apagada todo sigue en el bot, incluso un reenvío', () => {
    expect(decidirRuta(entrada({ modules: APAGADA }))).toBe('bot')
    expect(decidirRuta(entrada({ modules: APAGADA, reenviado: true }))).toBe('bot')
    expect(decidirRuta(entrada({ modules: null }))).toBe('bot')
    expect(decidirRuta(entrada({ modules: APAGADA, tipo: 'audio', texto: '' }))).toBe('bot')
  })

  it('solo el `true` literal la enciende', () => {
    expect(decidirRuta(entrada({ modules: { [LLAVE_BANDEJA]: 'true' } }))).toBe('bot')
    expect(decidirRuta(entrada({ modules: { [LLAVE_BANDEJA]: 1 } }))).toBe('bot')
  })

  it('encendida: un escrito suelto, una nota de voz y un pantallazo van a la bandeja', () => {
    expect(decidirRuta(entrada({}))).toBe('bandeja')
    expect(decidirRuta(entrada({ tipo: 'audio', texto: '' }))).toBe('bandeja')
    expect(decidirRuta(entrada({ tipo: 'image', texto: '' }))).toBe('bandeja')
  })

  it('un reenvío va a la bandeja aunque haya un gasto a medias y aunque diga «gasto»', () => {
    expect(decidirRuta(entrada({ reenviado: true, sesionBotEsperando: true }))).toBe('bandeja')
    expect(decidirRuta(entrada({ reenviado: true, texto: 'gasto 20000 taxi' }))).toBe('bandeja')
  })

  it('un gasto a medias sigue en el bot (no se rompe la foto que espera)', () => {
    expect(decidirRuta(entrada({ sesionBotEsperando: true, tipo: 'image', texto: '' }))).toBe('bot')
  })

  it('«gasto …» escrito va al bot; «gastos del hotel» no es el prefijo', () => {
    expect(decidirRuta(entrada({ texto: 'gasto 20000 taxi' }))).toBe('bot')
    expect(decidirRuta(entrada({ texto: 'Gasto: 45.000 almuerzo' }))).toBe('bot')
    expect(decidirRuta(entrada({ texto: 'gastos del hotel incluidos?' }))).toBe('bandeja')
  })

  it('los prefijos se configuran por workspace', () => {
    const config = leerConfigBandeja({ bandeja_solicitudes: { prefijos_bot: ['gasto', 'bot'] } })
    expect(decidirRuta(entrada({ config, texto: 'bot cartera' }))).toBe('bot')
  })
})

describe('palabra de cierre', () => {
  it('«listo» solo, con mayúsculas, tildes o puntuación, cierra', () => {
    for (const t of ['listo', 'Listo', 'LISTO!', ' listo. ', '¡Listo!']) {
      expect(esPalabraCierre(t, ['listo']), t).toBe(true)
    }
  })

  it('dentro de una frase no cierra', () => {
    expect(esPalabraCierre('listo, el cliente es Pedro', ['listo'])).toBe(false)
    expect(esPalabraCierre('ya está listo el viaje?', ['listo'])).toBe(false)
    expect(esPalabraCierre('', ['listo'])).toBe(false)
  })

  it('se configura, y una lista mal escrita cae al default', () => {
    expect(leerConfigBandeja({ bandeja_solicitudes: { palabras_cierre: ['Fin', 'ya'] } }).palabrasCierre).toEqual(['fin', 'ya'])
    expect(leerConfigBandeja({ bandeja_solicitudes: { palabras_cierre: 'fin' } }).palabrasCierre).toEqual(['listo'])
  })
})

describe('config', () => {
  it('sin config, los defaults', () => {
    expect(leerConfigBandeja(null)).toEqual(CONFIG_BANDEJA_POR_DEFECTO)
    expect(leerConfigBandeja({})).toEqual(CONFIG_BANDEJA_POR_DEFECTO)
  })

  it('la ventana acepta 1..120 minutos; lo demás cae a 5 (mismo tope que la función SQL)', () => {
    expect(leerConfigBandeja({ bandeja_solicitudes: { ventana_minutos: 10 } }).ventanaMinutos).toBe(10)
    expect(leerConfigBandeja({ bandeja_solicitudes: { ventana_minutos: '15' } }).ventanaMinutos).toBe(15)
    expect(leerConfigBandeja({ bandeja_solicitudes: { ventana_minutos: 0 } }).ventanaMinutos).toBe(5)
    expect(leerConfigBandeja({ bandeja_solicitudes: { ventana_minutos: 500 } }).ventanaMinutos).toBe(5)
    expect(leerConfigBandeja({ bandeja_solicitudes: { ventana_minutos: 'diez' } }).ventanaMinutos).toBe(5)
  })
})

describe('lo que contesta el bot', () => {
  it('solo pregunta al cerrar; no confirma cada mensaje ni los duplicados', () => {
    expect(respuestaTrasRegistro('cerrar')).toBe('pregunta')
    expect(respuestaTrasRegistro('abrir')).toBeNull()
    expect(respuestaTrasRegistro('agregar')).toBeNull()
    expect(respuestaTrasRegistro('duplicado')).toBeNull()
    expect(respuestaTrasRegistro('cierre_sin_abierta')).toBe('nada_pendiente')
    expect(respuestaTrasRegistro('respuesta_cliente')).toBe('anotado')
  })

  it('la pregunta cuenta los mensajes, en singular y plural', () => {
    expect(textoPreguntaCliente(6)).toBe('Recibí 6 mensajes. ¿De qué cliente es?')
    expect(textoPreguntaCliente(1)).toBe('Recibí 1 mensaje. ¿De qué cliente es?')
  })
})

describe('cuerpo del mensaje', () => {
  it('texto completo, sin cortar a 100', () => {
    const largo = 'x'.repeat(900)
    expect(cuerpoDelMensaje({ type: 'text', text: largo })).toEqual({ cuerpo: largo, origen: 'texto' })
  })

  it('foto: el pie si lo hay; sin pie, cuerpo vacío (el archivo queda por su id)', () => {
    expect(cuerpoDelMensaje({ type: 'image', text: 'hotel que le gustó' })).toEqual({ cuerpo: 'hotel que le gustó', origen: 'pie_de_foto' })
    expect(cuerpoDelMensaje({ type: 'image', text: '' })).toEqual({ cuerpo: null, origen: null })
  })

  it('audio: lo resuelve la transcripción, no esta función', () => {
    expect(cuerpoDelMensaje({ type: 'audio', text: '' })).toEqual({ cuerpo: null, origen: null })
  })

  it('la hora de Meta viene en segundos', () => {
    expect(fechaDeMeta('1757943060')).toBe('2025-09-15T13:31:00.000Z')
    expect(fechaDeMeta(undefined)).toBeNull()
    expect(fechaDeMeta('')).toBeNull()
  })
})

describe('el reenvío se lee del payload de Meta', () => {
  const PROPIO = '111'
  const webhook = (messages: unknown[]) => ({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: PROPIO }, messages } }] }],
  })

  it('`context.forwarded` marca el mensaje como reenviado', () => {
    const r = extraerEntrante(webhook([{
      from: '573001234567', id: 'wamid.f1', timestamp: '1757943060', type: 'text',
      text: { body: 'Somos 4, salimos el 12' }, context: { forwarded: true },
    }]) as never, PROPIO)
    expect(r?.tipo).toBe('con_telefono')
    if (r?.tipo !== 'con_telefono') return
    expect(r.mensaje.reenviado).toBe(true)
    expect(r.mensaje.reenviado_muchas_veces).toBeUndefined()
  })

  it('`frequently_forwarded` marca las dos cosas', () => {
    const r = extraerEntrante(webhook([{
      from: '573001234567', id: 'wamid.f2', timestamp: '1757943060', type: 'text',
      text: { body: 'x' }, context: { frequently_forwarded: true },
    }]) as never, PROPIO)
    if (r?.tipo !== 'con_telefono') throw new Error('sin telefono')
    expect(r.mensaje.reenviado).toBe(true)
    expect(r.mensaje.reenviado_muchas_veces).toBe(true)
  })

  it('un mensaje normal no trae la marca (sale igual que antes)', () => {
    const r = extraerEntrante(webhook([{
      from: '573001234567', id: 'wamid.f3', timestamp: '1757943060', type: 'text', text: { body: 'hola' },
    }]) as never, PROPIO)
    if (r?.tipo !== 'con_telefono') throw new Error('sin telefono')
    expect('reenviado' in r.mensaje).toBe(false)
  })

  it('la foto y el toque de botón ahora traen su wamid (sin él no hay deduplicación)', () => {
    const foto = extraerEntrante(webhook([{
      from: '573001234567', id: 'wamid.img', timestamp: '1757943060', type: 'image', image: { id: 'm1' },
      context: { forwarded: true },
    }]) as never, PROPIO)
    if (foto?.tipo !== 'con_telefono') throw new Error('sin telefono')
    expect(foto.mensaje.wa_message_id).toBe('wamid.img')
    expect(foto.mensaje.reenviado).toBe(true)
  })
})

describe('la llave vive en el catálogo de módulos', () => {
  it('es una llave de función de Clarity', () => {
    expect(MODULOS.clarity.funciones as readonly string[]).toContain(LLAVE_BANDEJA)
  })
})

describe('cableado en wa-webhook', () => {
  const fuente = readFileSync('supabase/functions/wa-webhook/index.ts', 'utf8')
  const inicio = fuente.indexOf('async function processMessage(')
  const pm = fuente.slice(inicio, fuente.indexOf('\n}\n', inicio))

  it('la bandeja va después de identificar al remitente y antes del tope, la sesión y Gemini', () => {
    const bandeja = pm.indexOf('rutaDelMensaje(')
    expect(bandeja).toBeGreaterThan(-1)
    expect(bandeja).toBeGreaterThan(pm.indexOf('identifyUser('))
    expect(bandeja).toBeGreaterThan(pm.indexOf('atenderDesconocido('))
    expect(bandeja).toBeGreaterThan(pm.indexOf('atenderPendienteTerminos('))
    expect(bandeja).toBeLessThan(pm.indexOf('checkInboundLimit('))
    expect(bandeja).toBeLessThan(pm.indexOf('transcribeAudio(message.audio_id)', pm.indexOf('checkInboundLimit(')))
    expect(bandeja).toBeLessThan(pm.indexOf('getOrCreateSession('))
    expect(bandeja).toBeLessThan(pm.indexOf('parseMessage('))
  })

  it('lo que va a la bandeja no sigue al flujo de gastos', () => {
    const desde = pm.indexOf('atenderEnBandeja(')
    expect(desde).toBeGreaterThan(-1)
    expect(pm.slice(desde, pm.indexOf('}', desde))).toMatch(/return;/)
  })
})
