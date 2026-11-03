import { describe, expect, it } from 'vitest'
import { claseEntrante, claveDeduplicacion, filtrar, firmaChatwoot, leerPayload, verificarFirmaChatwoot } from './chatwoot-webhook'
import { CONFIG_PUBLICO_POR_DEFECTO, CORTES_VENTAS, TERMINOS_EJEMPLO, leerConfigPublico, variableSecreta } from './config'
import { enlacesFueraDeLista } from './enlaces'
import { preciosSinHerramienta } from './precios'
import { ventana, TOPE_SEGUIDOS_TIKTOK } from './ventana'
import { cuandoBogota, vigentes, funcionesFuturas } from './catalogo'
import { esNoSolo, respuestaA, motivoAviso } from './autorizacion'
import { dichoTras } from './dominio'
import { corte1Propuesto } from './arnes/calificar'
import { cuerpoMensajeChatwoot, mensajeroChatwootApi } from './produccion'
import { mimeDeAudio, transcribirAudio } from './transcribir'
import { recibir } from './entrada'
import type { PuertosEntrada } from './entrada'
import { PAYLOAD_DOC_AUDIO, PAYLOAD_DOC_BOTON, PAYLOAD_DOC_MESSAGE_CREATED } from './arnes/fixture-chatwoot'
import { reglamentoSabor } from './escenario'
import type { FilaPublica } from './tipos'

/** Las piezas puras del asistente público. Datos inventados; el payload de Chatwoot es el armado de la doc (marcado). */

const fila = (p: Partial<FilaPublica> & Pick<FilaPublica, 'direccion' | 'created_at'>): FilaPublica =>
  ({ id: Math.random().toString(36), workspace_id: 'w', phone: '77:1', clase: p.direccion === 'entrante' ? 'escrito' : 'bot', texto: 'x', canal: 'instagram', ...p })

describe('firma del Agent Bot (§3.3)', () => {
  const cuerpo = JSON.stringify(PAYLOAD_DOC_MESSAGE_CREATED)
  it('acepta la firma buena dentro de 5 minutos y rechaza vieja, distinta o sin secreto', async () => {
    const ts = '1792000000'
    const firma = await firmaChatwoot('s3cr3t', ts, cuerpo)
    expect(firma).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(await verificarFirmaChatwoot({ secreto: 's3cr3t', firma, timestamp: ts, cuerpo, ahoraS: 1792000000 + 299 })).toEqual({ ok: true })
    expect(await verificarFirmaChatwoot({ secreto: 's3cr3t', firma, timestamp: ts, cuerpo, ahoraS: 1792000000 + 301 })).toEqual({ ok: false, motivo: 'vieja' })
    expect(await verificarFirmaChatwoot({ secreto: 'otro', firma, timestamp: ts, cuerpo, ahoraS: 1792000000 })).toEqual({ ok: false, motivo: 'distinta' })
    expect(await verificarFirmaChatwoot({ secreto: 's3cr3t', firma, timestamp: ts, cuerpo: `${cuerpo} `, ahoraS: 1792000000 })).toEqual({ ok: false, motivo: 'distinta' })
    expect(await verificarFirmaChatwoot({ secreto: undefined, firma, timestamp: ts, cuerpo, ahoraS: 1792000000 })).toEqual({ ok: false, motivo: 'sin_secreto' })
    expect(await verificarFirmaChatwoot({ secreto: 's3cr3t', firma: null, timestamp: ts, cuerpo, ahoraS: 1792000000 })).toEqual({ ok: false, motivo: 'sin_firma' })
  })
})

describe('payload y filtros (§3.2)', () => {
  const o = { inboxes: [5], cuentaId: 77 }
  it('el mensaje de la doc pasa; cada filtro ataja lo suyo', () => {
    const m = leerPayload(PAYLOAD_DOC_MESSAGE_CREATED)
    expect(filtrar(m, o)).toEqual({ pasa: true })
    expect(filtrar(leerPayload({ ...PAYLOAD_DOC_MESSAGE_CREATED, event: 'conversation_updated' }), o)).toMatchObject({ motivo: 'evento' })
    expect(filtrar(leerPayload({ ...PAYLOAD_DOC_MESSAGE_CREATED, message_type: 'outgoing' }), o)).toMatchObject({ motivo: 'saliente' })
    expect(filtrar(leerPayload({ ...PAYLOAD_DOC_MESSAGE_CREATED, private: true }), o)).toMatchObject({ motivo: 'privado' })
    expect(filtrar(leerPayload({ ...PAYLOAD_DOC_MESSAGE_CREATED, sender: { id: 1, type: 'user' } }), o)).toMatchObject({ motivo: 'remitente' })
    expect(filtrar(leerPayload({ ...PAYLOAD_DOC_MESSAGE_CREATED, conversation: { ...PAYLOAD_DOC_MESSAGE_CREATED.conversation, status: 'open' } }), o)).toMatchObject({ motivo: 'no_pending' })
    expect(filtrar(m, { inboxes: [6], cuentaId: 77 })).toMatchObject({ motivo: 'inbox' })
    expect(filtrar(m, { inboxes: [5], cuentaId: 78 })).toMatchObject({ motivo: 'cuenta' })
  })
  it('message_type como entero (0) también es entrante; sin tipo de remitente queda marcado', () => {
    const m = leerPayload({ ...PAYLOAD_DOC_MESSAGE_CREATED, message_type: 0, sender: { id: 1 } })
    expect(m.entrante).toBe(true)
    expect(m.remitenteSinTipo).toBe(true)
    expect(filtrar(m, o)).toEqual({ pasa: true })
  })
  it('message_updated solo pasa con audio; el audio usa data_url e ignora transcribed_text', () => {
    expect(filtrar(leerPayload({ ...PAYLOAD_DOC_MESSAGE_CREATED, event: 'message_updated' }), o)).toMatchObject({ motivo: 'evento' })
    const a = leerPayload({ ...PAYLOAD_DOC_AUDIO, event: 'message_updated' })
    expect(filtrar(a, o)).toEqual({ pasa: true })
    expect(a.adjuntos[0]).toEqual({ tipo: 'audio', url: PAYLOAD_DOC_AUDIO.attachments[0].data_url, extension: 'ogg' })
    expect(JSON.stringify(a)).not.toContain('NO SE USA')
    expect(claseEntrante(a)).toBe('audio')
  })
  it('el botón llega como toque con su valor; la deduplicación es por cuenta y mensaje', () => {
    const b = leerPayload(PAYLOAD_DOC_BOTON)
    expect(claseEntrante(b)).toBe('toque')
    expect(b.valorBoton).toBe('ag|a|general|si')
    expect(claveDeduplicacion(b)).toBe('chatwoot:msg:77:424244')
  })
})

describe('configuración (`bot_conversacional.chatwoot`)', () => {
  it('sin la llave queda apagado; con valores raros, los defectos; nunca respaldo', () => {
    expect(leerConfigPublico(undefined).activo).toBe(false)
    const c = leerConfigPublico({ chatwoot: { activo: true, cuenta_id: '77', inboxes: [{ id: 5, canal: 'tiktok' }, { id: 'x' }], corte_1_ms: 6000, corte_total_ms: 3000, respaldo: { modelo: 'gemini-3.8-flash' }, terminos_url: 'http://inseguro', modelo: { esfuerzo: 'medium', pensamiento: true } } })
    expect(c.activo).toBe(true)
    expect(c.cuentaId).toBe(77)
    expect(c.inboxes).toEqual([{ id: 5, canal: 'tiktok', anuncio7Dias: false }])
    expect(c.respaldo).toBeNull()
    expect(c.corteTotalMs).toBe(7000)
    expect(c.terminosUrl).toBe(TERMINOS_EJEMPLO)
    expect(c.modelo).toMatchObject({ proveedor: 'anthropic', modelo: 'claude-haiku-5-5', esfuerzo: 'medium', pensamiento: true })
    expect(CONFIG_PUBLICO_POR_DEFECTO.rafagaMs).toBe(2500)
    expect(variableSecreta('CHATWOOT_API_TOKEN', 'sabor-experiencias')).toBe('CHATWOOT_API_TOKEN_SABOR_EXPERIENCIAS')
  })
  it('ventas (Dimpro) usa 20 s / 45 s por defecto: el aviso de demora no sale en un turno normal; Sabor sigue en 5 s / 20 s', () => {
    // Messenger, 29-oct: los turnos de ventas tardan 7-13 s y con 5 s el aviso salía en casi todos.
    expect(leerConfigPublico({ chatwoot: { activo: true, dominio: 'ventas' } })).toMatchObject({ corte1Ms: CORTES_VENTAS.corte1Ms, corteTotalMs: CORTES_VENTAS.corteTotalMs })
    expect(CORTES_VENTAS.corte1Ms).toBeGreaterThanOrEqual(20_000)
    expect(leerConfigPublico({ chatwoot: { activo: true } })).toMatchObject({ corte1Ms: 5000, corteTotalMs: 20000 })
    // Lo que fije config_extra manda, en los dos dominios.
    expect(leerConfigPublico({ chatwoot: { activo: true, dominio: 'ventas', corte_1_ms: 9000, corte_total_ms: 30000 } })).toMatchObject({ corte1Ms: 9000, corteTotalMs: 30000 })
  })
})

describe('ventanas por canal (§9)', () => {
  const ahora = Date.parse('2026-10-23T15:00:00Z')
  const hace = (h: number) => new Date(ahora - h * 3600 * 1000).toISOString()
  it('24 h en WhatsApp e Instagram, 7 días con anuncio, 48 h en TikTok', () => {
    const filas = [fila({ direccion: 'entrante', created_at: hace(25) })]
    expect(ventana({ canal: 'whatsapp', filas, ahoraMs: ahora })).toMatchObject({ abierta: false, motivo: 'vencida' })
    expect(ventana({ canal: 'instagram', filas, ahoraMs: ahora })).toMatchObject({ abierta: false })
    expect(ventana({ canal: 'instagram', anuncio7Dias: true, filas, ahoraMs: ahora })).toMatchObject({ abierta: true })
    expect(ventana({ canal: 'tiktok', filas, ahoraMs: ahora })).toMatchObject({ abierta: true, quedan: TOPE_SEGUIDOS_TIKTOK })
  })
  it('TikTok: no más de 10 mensajes nuestros seguidos', () => {
    const filas = [fila({ direccion: 'entrante', created_at: hace(1) }), ...Array.from({ length: 9 }, () => fila({ direccion: 'saliente', estado: 'publicado', created_at: hace(0.5) }))]
    expect(ventana({ canal: 'tiktok', filas, ahoraMs: ahora })).toMatchObject({ abierta: true, quedan: 1 })
    expect(ventana({ canal: 'tiktok', filas, ahoraMs: ahora, cuantos: 2 })).toMatchObject({ abierta: false, motivo: 'tope_tiktok' })
  })
})

describe('links, precios y catálogo', () => {
  it('links: solo los de la lista (con o sin www, con ruta debajo)', () => {
    const ok = ['https://sabor.invalid/terminos', 'https://maps.invalid']
    expect(enlacesFueraDeLista('Mira https://sabor.invalid/terminos y www.maps.invalid/x.', ok)).toEqual([])
    expect(enlacesFueraDeLista('Paga en https://sabor.invalid.estafa.co/terminos', ok)).toEqual(['https://sabor.invalid.estafa.co/terminos'])
    expect(enlacesFueraDeLista('https://sabor.invalid/terminos-falsos', ok)).toEqual(['https://sabor.invalid/terminos-falsos'])
  })
  it('precios: solo los que devolvió una herramienta; «95 mil» = 95000', () => {
    const fuentes = ['{"precio_por_persona":"$95.000"}']
    expect(preciosSinHerramienta('Vale $95.000 por persona, o sea 95 mil.', fuentes)).toEqual([])
    expect(preciosSinHerramienta('Te queda en $50.000', fuentes)).toEqual(['$50.000'])
    expect(preciosSinHerramienta('son 80 mil pesos', fuentes)).toEqual(['80 mil'])
  })
  it('catálogo: solo vigentes hoy en Bogotá; funciones futuras; fechas en hora de Bogotá', async () => {
    const r = await reglamentoSabor()
    expect(vigentes(r, Date.parse('2026-10-23T15:00:00Z')).map((e) => e.id)).toEqual(['ejemplo-cena-1'])
    // 04:30 UTC del 19 = 23:30 del 18 en Bogotá: todavía la de la semana pasada; 05:30 UTC = 00:30 del 19: ya la nueva.
    expect(vigentes(r, Date.parse('2026-10-19T04:30:00Z')).map((e) => e.id)).toEqual(['ejemplo-vencida'])
    expect(vigentes(r, Date.parse('2026-10-19T05:30:00Z')).map((e) => e.id)).toEqual(['ejemplo-cena-1'])
    expect(funcionesFuturas(r, 'ejemplo-cena-1', Date.parse('2026-10-23T15:00:00Z')).map((f) => f.id)).toEqual(['f-ej-1', 'f-ej-2', 'f-ej-3'])
    expect(cuandoBogota('2026-10-24T19:00:00-05:00')).toMatch(/^sábado, 24 de octubre, 7:00 p\. ?m\.$/)
  })
})

describe('autorización (§5)', () => {
  it('solo cuenta «sí»/«no» escrito solo o el botón del mismo tipo', () => {
    expect(respuestaA('general', { clase: 'escrito', texto: 'Sí', toque_id: null })).toBe('si')
    expect(respuestaA('general', { clase: 'escrito', texto: 'si claro, me llamo Ana', toque_id: null })).toBeNull()
    expect(respuestaA('general', { clase: 'escrito', texto: 'NO', toque_id: null })).toBe('no')
    expect(respuestaA('general', { clase: 'toque', texto: 'Sí', toque_id: 'ag|a|general|si' })).toBe('si')
    expect(respuestaA('general', { clase: 'toque', texto: 'Sí', toque_id: 'ag|a|sensible|si' })).toBeNull()
    expect(respuestaA('general', { clase: 'audio', texto: 'sí', toque_id: null })).toBeNull()
    expect(esNoSolo('no.')).toBe(true)
  })
  it('el dato tiene que estar escrito después del «sí»', () => {
    expect(dichoTras('nombre', 'Ana Pérez', 'me llamo ana perez')).toBe(true)
    expect(dichoTras('nombre', 'Ana Pérez', 'ana')).toBe(false)
    expect(dichoTras('cedula', '52.123.456', 'cc 52123456')).toBe(true)
    expect(dichoTras('telefono', '+57 300 123 4567', 'mi cel es 3001234567')).toBe(true)
  })
  it('el aviso va primero, al volver de persona y tras 24 h', () => {
    const t0 = Date.parse('2026-10-23T15:00:00Z')
    const iso = (h: number) => new Date(t0 + h * 3600 * 1000).toISOString()
    const nuevo = fila({ direccion: 'entrante', created_at: iso(0) })
    expect(motivoAviso([nuevo], new Set([nuevo.id]), t0, 24)).toBe('primero')
    const conAviso = fila({ direccion: 'entrante', created_at: iso(0), turno_id: 't', traza: { tipo: 'modelo', bot: 'b', aviso: { clave: 'rf.bienvenida', version: 'v', huella: 'h', motivo: 'primero' } } })
    const otro = fila({ direccion: 'entrante', created_at: iso(1) })
    expect(motivoAviso([conAviso, otro], new Set([otro.id]), t0, 24)).toBeNull()
    const tarde = fila({ direccion: 'entrante', created_at: iso(25) })
    expect(motivoAviso([conAviso, tarde], new Set([tarde.id]), t0, 24)).toBe('pausa_larga')
  })
})

describe('corte_1 desde el p95 (§4.1)', () => {
  it('redondea arriba al segundo, con piso de 5 s y techo de 8 s', () => {
    expect(corte1Propuesto([1000, 2000, 3000]).corte1Ms).toBe(5000)
    expect(corte1Propuesto([...Array(9).fill(2000), 6200]).corte1Ms).toBe(7000)
    expect(corte1Propuesto([...Array(19).fill(2000), 6200]).corte1Ms).toBe(5000)
    expect(corte1Propuesto([9100]).corte1Ms).toBe(8000)
    expect(corte1Propuesto([9100]).pasaTecho).toBe(true)
  })
})

describe('Chatwoot (API de aplicación)', () => {
  it('botones y listas van como input_select con los ids del código; la nota es privada', () => {
    expect(cuerpoMensajeChatwoot({ tipo: 'botones', texto: '¿Autorizas?', opciones: [{ id: 'ag|a|general|si', titulo: 'Sí' }, { id: 'ag|a|general|no', titulo: 'No' }] }))
      .toEqual({ content: '¿Autorizas?', message_type: 'outgoing', private: false, content_type: 'input_select', content_attributes: { items: [{ title: 'Sí', value: 'ag|a|general|si' }, { title: 'No', value: 'ag|a|general|no' }] } })
    expect(cuerpoMensajeChatwoot({ tipo: 'texto', texto: 'nota' }, true)).toEqual({ content: 'nota', message_type: 'outgoing', private: true })
  })
  it('etiquetar suma a las que ya tiene; un 5xx al publicar queda incierto (no se reintenta a ciegas)', async () => {
    const pedidos: Array<{ url: string; metodo: string; cuerpo: unknown; token: string | null }> = []
    let estado = 200
    const f = (async (u: string, i: RequestInit) => {
      pedidos.push({ url: u, metodo: String(i.method), cuerpo: i.body ? JSON.parse(String(i.body)) : null, token: (i.headers as Record<string, string>).api_access_token })
      if (u.endsWith('/labels') && i.method === 'GET') return new Response(JSON.stringify({ payload: ['vip'] }))
      return new Response(JSON.stringify({ id: 9 }), { status: estado })
    }) as unknown as typeof fetch
    const m = mensajeroChatwootApi({ apiUrl: 'https://chatwoot.invalid', token: 'tok', fetch: f })
    const l = { workspaceId: 'w', cuentaId: 77, conversacionId: 9001 }
    expect(await m.etiquetar(l, ['reserva'])).toBe(true)
    expect(pedidos.at(-1)).toMatchObject({ url: 'https://chatwoot.invalid/api/v1/accounts/77/conversations/9001/labels', metodo: 'POST', cuerpo: { labels: ['vip', 'reserva'] }, token: 'tok' })
    expect(await m.publicar(l, { tipo: 'texto', texto: 'hola' })).toEqual({ ok: true, id: 9 })
    estado = 502
    expect(await m.publicar(l, { tipo: 'texto', texto: 'hola' })).toMatchObject({ ok: false, incierto: true })
    estado = 422
    expect(await m.publicar(l, { tipo: 'texto', texto: 'hola' })).toMatchObject({ ok: false, incierto: false })
    expect(await m.abrir(l)).toBe(false)
  })
})

describe('transcripción por URL (§4.2)', () => {
  it('la llave va en la cabecera, nunca en la URL; solo vale si terminó (STOP)', async () => {
    const vistos: Array<{ url: string; llave: string | null }> = []
    let fin = 'STOP'
    const f = (async (u: string, i: RequestInit = {}) => {
      vistos.push({ url: u, llave: (i.headers as Record<string, string> | undefined)?.['x-goog-api-key'] ?? null })
      if (u.startsWith('https://chatwoot.invalid')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/ogg; codecs=opus' } })
      return new Response(JSON.stringify({ candidates: [{ finishReason: fin, content: { parts: [{ text: 'quiero reservar' }] } }] }))
    }) as unknown as typeof fetch
    const o = { llave: 'llave-pago', modelo: 'gemini-3.5-flash-lite', maxBytes: 1000, fetch: f }
    expect(await transcribirAudio({ url: 'https://chatwoot.invalid/a.ogg' }, o)).toEqual({ texto: 'quiero reservar' })
    expect(vistos[1].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
    expect(vistos[1].url).not.toContain('key=')
    expect(vistos[1].llave).toBe('llave-pago')
    fin = 'MAX_TOKENS'
    expect((await transcribirAudio({ url: 'https://chatwoot.invalid/a.ogg' }, o)).texto).toBeNull()
    expect((await transcribirAudio({ url: 'https://chatwoot.invalid/a.ogg' }, { ...o, llave: '' })).error).toMatch(/SIN_LLAVE_PAGO/)
    expect((await transcribirAudio({ bytes: new Uint8Array(2000), mime: 'audio/ogg' }, { ...o })).error).toMatch(/MUY_GRANDE/)
    expect(mimeDeAudio(null, 'm4a')).toBe('audio/mp4')
    expect(mimeDeAudio('audio/opus', null)).toBe('audio/ogg')
  })
})

describe('la petición del webhook (§3.1)', () => {
  const secreto = 's'
  const puertos = (o: Partial<PuertosEntrada> = {}): PuertosEntrada & { claves: Set<string> } => {
    const claves = new Set<string>()
    return {
      claves,
      secreto: () => secreto,
      workspace: async () => ({ id: 'ws', slug: 'sabor-prueba', config: { ...CONFIG_PUBLICO_POR_DEFECTO, activo: true, cuentaId: 77, inboxes: [{ id: 5, canal: 'instagram', anuncio7Dias: false }] } }),
      primeraVez: async (k) => { if (claves.has(k)) return false; claves.add(k); return true },
      olvidar: async (k) => { claves.delete(k) },
      guardarEntrante: async () => 'ok',
      registrarCierre: async () => true,
      completarAudio: async () => true,
      ahoraS: () => 1792000000,
      reloj: () => 0,
      ...o,
    }
  }
  const pedir = async (payload: unknown, p: PuertosEntrada, firmaMala = false) => {
    const cuerpo = JSON.stringify(payload)
    const firma = await firmaChatwoot(firmaMala ? 'x' : secreto, '1792000000', cuerpo)
    return recibir({ slug: 'sabor-prueba', cuerpo, firma, timestamp: '1792000000' }, p)
  }
  it('firma mala → 401; filtrado → 200 sin trabajo; guardado → 200 con trabajo', async () => {
    expect((await pedir(PAYLOAD_DOC_MESSAGE_CREATED, puertos(), true)).status).toBe(401)
    expect(await pedir({ ...PAYLOAD_DOC_MESSAGE_CREATED, private: true }, puertos())).toMatchObject({ status: 200, motivo: 'filtrado: privado' })
    const r = await pedir(PAYLOAD_DOC_MESSAGE_CREATED, puertos())
    expect(r.status).toBe(200)
    expect(r.atender?.llave).toEqual({ workspaceId: 'ws', cuentaId: 77, conversacionId: 9001 })
  })
  it('si la base falla al guardar: 500 y suelta la deduplicación para que el reintento entre', async () => {
    const p = puertos({ guardarEntrante: async () => 'error' })
    expect((await pedir(PAYLOAD_DOC_MESSAGE_CREATED, p)).status).toBe(500)
    expect(p.claves.size).toBe(0)
  })
  it('asistente apagado en la configuración: 200 y nada', async () => {
    const p = puertos({ workspace: async () => ({ id: 'ws', slug: 's', config: CONFIG_PUBLICO_POR_DEFECTO }) })
    const r = await pedir(PAYLOAD_DOC_MESSAGE_CREATED, p)
    expect(r.status).toBe(200)
    expect(r.atender).toBeUndefined()
  })
  it('Chatwoot resuelve la conversación: deja la marca de cierre (no es un mensaje que atender)', async () => {
    const cierres: unknown[] = []
    const p = puertos({ registrarCierre: async (c) => { cierres.push(c); return true } })
    expect(await pedir({ event: 'conversation_status_changed', status: 'resolved', id: 9001, inbox_id: 5 }, p)).toMatchObject({ status: 200, motivo: 'cierre registrado' })
    expect(cierres).toEqual([{ llave: { workspaceId: 'ws', cuentaId: 77, conversacionId: 9001 }, inboxId: 5, canal: 'instagram' }])
    expect(await pedir({ event: 'conversation_status_changed', status: 'resolved', id: 9001, inbox_id: 6 }, p)).toMatchObject({ motivo: 'cierre de otro inbox' })
    expect(cierres).toHaveLength(1)
  })
  it('message_updated con audio completa la URL sin deduplicar', async () => {
    const p = puertos()
    const r = await pedir({ ...PAYLOAD_DOC_AUDIO, event: 'message_updated' }, p)
    expect(r).toMatchObject({ status: 200, motivo: 'audio completado' })
    expect(p.claves.size).toBe(0)
  })
})
