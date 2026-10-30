import { describe, expect, it } from 'vitest'
import { claseEntrante, leerPayload } from './chatwoot-webhook'
import { toquesPorTitulo } from './cola'
import type { FilaPublica } from './tipos'

/**
 * Messenger por Chatwoot (Dimpro, 30-oct, en vivo): el botón tocado («Sí, enviar link») llegó como texto con el título,
 * clase 'escrito', toque_id null. El webhook no guarda el payload crudo: este es el de un `message_created` de Messenger
 * reconstruido con los campos que lee `leerPayload` (sin `content_attributes.submitted_values`, como dejó la fila).
 */
const PAYLOAD_MESSENGER = {
  event: 'message_created', id: 9001, content: 'Sí, enviar link', message_type: 'incoming', content_type: 'text', private: false,
  content_attributes: {}, account: { id: 189134 }, inbox: { id: 151556, channel_type: 'Channel::FacebookPage' },
  conversation: { id: 3, status: 'pending', channel: 'Channel::FacebookPage' }, sender: { type: 'contact', name: 'Cliente de prueba' }, attachments: [],
}

const fila = (x: Partial<FilaPublica>): FilaPublica => ({
  id: String(Math.random()), workspace_id: 'w', phone: '189134:3', direccion: 'entrante', clase: 'escrito', texto: null, canal: 'otro',
  created_at: '2026-10-30T13:40:00Z', ...x,
}) as FilaPublica
const PROPUESTA = fila({
  direccion: 'saliente', clase: 'bot', texto: 'Revisa tu pedido…', turno_id: 't1', ranura: 'respuesta',
  opciones: [{ id: 'ag|p|abc123|si', titulo: 'Sí, enviar link' }, { id: 'ag|p|abc123|no', titulo: 'Corregir' }],
})

describe('Messenger: el toque llega como texto con el título del botón', () => {
  it('el payload de Messenger no trae el id del botón: queda escrito', () => {
    const m = leerPayload(PAYLOAD_MESSENGER)
    expect(m.valorBoton).toBeNull()
    expect(claseEntrante(m)).toBe('escrito')
    // Si algún día llega `submitted_values`, manda el id (toque de verdad).
    const conId = leerPayload({ ...PAYLOAD_MESSENGER, content_attributes: { submitted_values: [{ title: 'Sí, enviar link', value: 'ag|p|abc123|si' }] } })
    expect(conId.valorBoton).toBe('ag|p|abc123|si')
    expect(claseEntrante(conId)).toBe('toque')
  })

  it('texto = título de una opción de la última salida con opciones → toque con su id (normalizado)', () => {
    for (const t of ['Sí, enviar link', 'si enviar link', '  SÍ,  ENVIAR LINK!! ']) {
      const [, f] = toquesPorTitulo([PROPUESTA, fila({ texto: t })], 'otro')
      expect(f).toMatchObject({ clase: 'toque', toque_id: 'ag|p|abc123|si' })
    }
    expect(toquesPorTitulo([PROPUESTA, fila({ texto: 'Corregir' })], 'otro')[1]).toMatchObject({ clase: 'toque', toque_id: 'ag|p|abc123|no' })
  })

  it('no toca: otro texto, otro canal, filas ya atendidas, un toque con id, ni sin salida con opciones', () => {
    expect(toquesPorTitulo([PROPUESTA, fila({ texto: 'Sí, enviar link porfa' })], 'otro')[1].clase).toBe('escrito')
    expect(toquesPorTitulo([PROPUESTA, fila({ texto: 'Sí, enviar link', canal: 'instagram' })], 'instagram')[1].clase).toBe('escrito')
    expect(toquesPorTitulo([PROPUESTA, fila({ texto: 'Sí, enviar link', turno_id: 't2' })], 'otro')[1].clase).toBe('escrito')
    expect(toquesPorTitulo([PROPUESTA, fila({ clase: 'toque', texto: 'Sí, enviar link', toque_id: 'ag|p|zzz|si' })], 'otro')[1].toque_id).toBe('ag|p|zzz|si')
    expect(toquesPorTitulo([fila({ texto: 'Sí, enviar link' })], 'otro')[0].clase).toBe('escrito')
  })

  it('manda la ÚLTIMA salida con opciones (la autorización después de una propuesta vieja, por ejemplo)', () => {
    const aut = fila({ direccion: 'saliente', clase: 'bot', texto: '¿Autorizas?', turno_id: 't2', ranura: 'respuesta', opciones: [{ id: 'ag|a|general|si', titulo: 'Sí' }, { id: 'ag|a|general|no', titulo: 'No' }] })
    expect(toquesPorTitulo([PROPUESTA, aut, fila({ texto: 'Sí' })], 'otro')[2].toque_id).toBe('ag|a|general|si')
    expect(toquesPorTitulo([PROPUESTA, aut, fila({ texto: 'Sí, enviar link' })], 'otro')[2].clase).toBe('escrito')
    // Una nota privada con opciones no cuenta como salida.
    const nota = fila({ direccion: 'saliente', clase: 'bot', texto: 'nota', ranura: 'nota_persona', opciones: [{ id: 'x', titulo: 'Sí' }] })
    expect(toquesPorTitulo([PROPUESTA, nota, fila({ texto: 'Sí, enviar link' })], 'otro')[2].toque_id).toBe('ag|p|abc123|si')
  })
})
