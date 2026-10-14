/**
 * Pegar una conversación en el viaje: lo que decide el CÓDIGO (partir el chat, las invariantes del bot, no pisar a una
 * persona, el resumen y la actividad). Lo que decide el modelo se mide aparte, con chats inventados contra Gemini.
 * Campos escritos a mano (no son una copia de la config de producción).
 */
import { describe, expect, it } from 'vitest'
import {
  cargarChatEnBloque, mensajesDelChat, normalizarChat, textoActividadChat, viajeParaModelo, TOPE_CHAT_CARACTERES,
} from './pegar-conversacion'
import { CLAVE_CONFLICTOS, CLAVE_SUGERIDOS, PREFIJO_ENTREGA_CHAT, textoSugerido } from './sugeridos'
import { esquemaCarga, instruccionesCarga } from '../../../supabase/functions/_shared/agente/bandeja/extraccion.ts'

const CAMPOS = [
  { slug: 'destino', label: 'Destino', tipo: 'texto', nivel: 'minimo', pregunta: '¿A dónde viajan?' },
  { slug: 'fecha_salida', label: 'Fecha de salida', tipo: 'fecha', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'adultos', label: 'Adultos', tipo: 'numero', nivel: 'minimo', pregunta: '¿Cuántos adultos viajan?' },
  { slug: 'infantes', label: 'Infantes', tipo: 'numero', nivel: 'minimo', pregunta: '¿Viajan bebés?' },
  {
    slug: 'presupuesto', label: 'Presupuesto', tipo: 'select', nivel: 'deseable', pregunta: '¿Cuánto quieren gastar?',
    opciones: [{ value: 'menos_3m', label: 'Menos de $3 M' }, { value: 'sin_definir', label: 'Aún no tiene presupuesto definido', no_definido: true }],
  },
  { slug: 'presentacion_destino', label: 'Presentación', tipo: 'texto', lo_llena: 'agencia' },
]

const HOY = '2026-10-11'
const AHORA = '2026-10-11T15:00:00.000Z'
const valor = (v: string, frase: string, extra: Record<string, unknown> = {}) => ({ valor: v, frase, ...extra })
const POR_DEFINIR = 'por_definir'

function raw(valores: Record<string, unknown>, mensajes: Array<{ n: number; clase: string }>, extra: Record<string, unknown> = {}) {
  const todos: Record<string, unknown> = {}
  for (const c of CAMPOS) todos[c.slug] = { valor: POR_DEFINIR, frase: '' }
  return { mensajes, valores: { ...todos, ...valores }, dudas: [], ...extra }
}

describe('el chat se parte sin leerlo', () => {
  it('quita las marcas invisibles de la exportación y el espacio angosto de la hora', () => {
    const t = '﻿[11/10/26, 10:15 a. m.] Ana: ‎<adjunto: foto.jpg>\r\nhola'
    expect(normalizarChat(t)).toBe('[11/10/26, 10:15 a. m.] Ana: <adjunto: foto.jpg>\nhola')
  })

  it('cada línea es un mensaje; las vacías no cuentan', () => {
    expect(mensajesDelChat('a\n\n  b  \n\n')).toEqual({ mensajes: ['a', 'b'], total: 2, recortado: false })
  })

  it('si no cabe, se queda con lo más reciente', () => {
    const linea = 'x'.repeat(100)
    const chat = Array.from({ length: 400 }, (_, i) => `${i} ${linea}`).join('\n')
    const r = mensajesDelChat(chat)
    expect(r.recortado).toBe(true)
    expect(r.total).toBe(400)
    expect(r.mensajes.at(-1)).toMatch(/^399 /)
    expect(r.mensajes.join('\n').length).toBeLessThanOrEqual(TOPE_CHAT_CARACTERES)
  })

  it('nombra el viaje para el modelo', () => {
    expect(viajeParaModelo({ codigo: 'P 26 4', nombre: 'Cartagena', cliente: 'Lina Prueba' })).toBe('P 26 4 «Cartagena», del cliente Lina Prueba')
    expect(viajeParaModelo({})).toBe('el viaje abierto')
  })
})

describe('el prompt del bot no cambia; el del chat agrega lo suyo', () => {
  it('sin chat no hay una palabra nueva y el esquema no pide «otros»', () => {
    const bot = instruccionesCarga(CAMPOS as never, HOY)
    expect(bot).not.toMatch(/CONVERSACIÓN|otros:/)
    expect((esquemaCarga(CAMPOS as never) as { properties: Record<string, unknown> }).properties).not.toHaveProperty('otros')
  })

  it('con chat nombra el viaje y pide «otros»', () => {
    const p = instruccionesCarga(CAMPOS as never, HOY, {}, {}, { viaje: 'P 26 4 «Cartagena»' })
    expect(p).toContain('El viaje es P 26 4 «Cartagena».')
    expect(p).toContain('5. otros:')
    expect((esquemaCarga(CAMPOS as never, { chat: true }) as { properties: Record<string, unknown> }).properties).toHaveProperty('otros')
  })
})

describe('cargar lo entendido sin pisar a nadie', () => {
  const MENSAJES = [
    '[10/10/26, 9:00] Ana Cliente: Hola, queremos ir a Cartagena',
    '[10/10/26, 9:01] Ana Cliente: salimos el 12 de diciembre, mi esposo y yo con la bebé de año y medio',
    '[10/10/26, 9:05] Agencia: Te paso una promo de San Andrés',
  ]
  const clases = [{ n: 1, clase: 'cliente' }, { n: 2, clase: 'cliente' }, { n: 3, clase: 'tercero' }]

  it('bloque vacío: llena como sugerido, con la huella (no el texto) en la marca', () => {
    const c = cargarChatEnBloque({
      fields: CAMPOS, data: {}, mensajes: MENSAJES, hoyISO: HOY, ahoraIso: AHORA, huella: 'abc123',
      raw: raw({
        destino: valor('Cartagena', 'queremos ir a Cartagena'),
        fecha_salida: valor('2026-12-12', 'salimos el 12 de diciembre'),
        adultos: valor('2', 'mi esposo y yo', { como: 'deducido', calculo: 'ella y su esposo' }),
        infantes: valor('1', 'la bebé de año y medio', { como: 'deducido', calculo: 'año y medio es menor de 2' }),
        presentacion_destino: valor('Un paraíso', 'Cartagena'),
      }, clases),
    })
    expect(c.data?.destino).toBe('CARTAGENA')
    expect(Object.keys(c.data?.[CLAVE_SUGERIDOS] as object).sort()).toEqual(['adultos', 'destino', 'fecha_salida', 'infantes'])
    const marca = (c.data?.[CLAVE_SUGERIDOS] as Record<string, { entrega_id: string; frase: string }>).infantes
    expect(marca.entrega_id).toBe(`${PREFIJO_ENTREGA_CHAT}abc123`)
    expect(marca.frase).toBe('la bebé de año y medio')
    expect(textoSugerido(marca as never)).toMatch(/^Sugerido de la conversación pegada/)
    // El campo que escribe la agencia no se llena, diga lo que diga el modelo.
    expect(c.data).not.toHaveProperty('presentacion_destino')
    expect(c.resumen.llenados).toContain('Infantes: 1 (deducido)')
    expect(c.resumen.faltaMinimo).toEqual([])
    expect(c.resumen.hayMinimo).toBe(true)
    expect(c.valores).toMatchObject({ adultos: 2, infantes: 1, fecha_salida: '2026-12-12' })
  })

  it('lo de un mensaje que el modelo marcó de otro viaje no sostiene nada', () => {
    const c = cargarChatEnBloque({
      fields: CAMPOS, data: {}, mensajes: MENSAJES, hoyISO: HOY, ahoraIso: AHORA, huella: 'h',
      raw: raw({ destino: valor('San Andrés', 'promo de San Andrés') }, clases, { otros: ['Promoción a San Andrés', '  '] }),
    })
    expect(c.data).toBeNull()
    expect(c.resumen.otros).toEqual(['Promoción a San Andrés'])
    expect(c.resumen.faltaMinimo).toEqual(['¿A dónde viajan?', '¿Qué día salen?', '¿Cuántos adultos viajan?', '¿Viajan bebés?'])
  })

  it('una frase que no está en el chat no llena', () => {
    const c = cargarChatEnBloque({
      fields: CAMPOS, data: {}, mensajes: MENSAJES, hoyISO: HOY, ahoraIso: AHORA, huella: 'h',
      raw: raw({ presupuesto: valor('menos_3m', 'algo económico') }, clases),
    })
    expect(c.data).toBeNull()
  })

  it('lo que escribió una persona no se pisa: va a conflicto; un sugerido sin confirmar sí se reemplaza', () => {
    const data = {
      adultos: 3,
      destino: 'SANTA MARTA',
      [CLAVE_SUGERIDOS]: { destino: { fuente: 'whatsapp', entrega_id: 'x', frase: 'santa marta', en: AHORA } },
    }
    const c = cargarChatEnBloque({
      fields: CAMPOS, data, mensajes: MENSAJES, hoyISO: HOY, ahoraIso: AHORA, huella: 'h',
      raw: raw({ adultos: valor('2', 'mi esposo y yo', { como: 'deducido' }), destino: valor('Cartagena', 'queremos ir a Cartagena') }, clases),
    })
    expect(c.data?.adultos).toBe(3)
    expect((c.data?.[CLAVE_CONFLICTOS] as Record<string, { valor: unknown }>).adultos.valor).toBe(2)
    expect(c.resumen.conflictos).toEqual(['Adultos: tiene 3, el chat dice 2'])
    expect(c.data?.destino).toBe('CARTAGENA')
    expect(c.resumen.reemplazados).toEqual(['Destino: SANTA MARTA → CARTAGENA'])
    expect(c.enConflicto).toEqual(['adultos'])
    expect(c.valores).toEqual({ destino: 'CARTAGENA' })
  })

  it('lo que el modelo duda no se llena: se pregunta', () => {
    const c = cargarChatEnBloque({
      fields: CAMPOS, data: {}, mensajes: MENSAJES, hoyISO: HOY, ahoraIso: AHORA, huella: 'h',
      raw: raw({ presupuesto: valor('menos_3m', 'Hola') }, clases, { dudas: [{ campo: 'presupuesto', pregunta: '¿Cuánto quieren gastar?', opciones: [] }] }),
    })
    expect(c.data).toBeNull()
    expect(c.resumen.dudas).toEqual(['Presupuesto: ¿Cuánto quieren gastar?'])
  })
})

describe('la actividad guarda la huella, no el chat', () => {
  it('empieza por la huella y no pasa de 280 caracteres', () => {
    const c = cargarChatEnBloque({
      fields: CAMPOS, data: {}, mensajes: ['[1] Ana: vamos a Cartagena'], hoyISO: HOY, ahoraIso: AHORA, huella: 'h',
      raw: raw({ destino: valor('Cartagena', 'vamos a Cartagena') }, [{ n: 1, clase: 'cliente' }]),
    })
    const t = textoActividadChat('0123456789abcdef', c, CAMPOS)
    expect(t).toBe('Conversación pegada (huella 0123456789abcdef, 1 mensajes). Sugirió: Destino.')
    const largo = textoActividadChat('0123456789abcdef', { ...c, sugeridos: Array(80).fill('destino') }, CAMPOS)
    expect([...largo].length).toBe(280)
    expect(largo.startsWith('Conversación pegada (huella 0123456789abcdef')).toBe(true)
  })
})
