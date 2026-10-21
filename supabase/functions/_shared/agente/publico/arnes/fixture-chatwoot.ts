// ============================================================
// Payload del webhook del Agent Bot de Chatwoot — ARMADO DE LA DOCUMENTACIÓN, NO ES UN PAYLOAD REAL
// ------------------------------------------------------------
// ⚠ Marcado: se reemplaza por un payload real anonimizado de la cuenta de Sabor cuando llegue (22-oct). Mientras, sale
// de la forma documentada de los eventos de webhook de Chatwoot (`message_created`: el mensaje con `account`,
// `conversation`, `inbox`, `sender` y `attachments`). SIN VERIFICAR (diseño §3.2 y §4.2):
//   · si `message_type` llega como «incoming» o como 0;
//   · el nombre exacto del tipo de remitente (`sender.type` / `sender_type`);
//   · el campo de la URL del audio (`attachments[].data_url`) y el formato de la nota de voz de Instagram;
//   · `content_attributes.submitted_values` al tocar un botón `input_select`.
// Datos inventados.
// ============================================================

export const PAYLOAD_DOC_MESSAGE_CREATED = {
  event: 'message_created',
  id: 424242,
  content: 'hola, quiero info de la experiencia',
  content_type: 'text',
  content_attributes: {},
  message_type: 'incoming',
  private: false,
  created_at: '2026-10-23T15:00:00.000Z',
  source_id: 'ig-mid-EJEMPLO',
  sender: { id: 9, name: 'Cliente Inventado', type: 'contact' },
  account: { id: 77, name: 'Sabor (EJEMPLO)' },
  inbox: { id: 5, name: 'Instagram Sabor (EJEMPLO)' },
  conversation: {
    id: 9001,
    status: 'pending',
    inbox_id: 5,
    channel: 'Channel::Instagram',
    can_reply: true,
    contact_inbox: { source_id: 'ig-EJEMPLO' },
  },
  attachments: [],
};

/** Una nota de voz (WhatsApp o Instagram): el adjunto con su URL (`data_url`). Chatwoot puede traer `transcribed_text`: se ignora. */
export const PAYLOAD_DOC_AUDIO = {
  ...PAYLOAD_DOC_MESSAGE_CREATED,
  id: 424243,
  content: null,
  attachments: [{ id: 1, file_type: 'audio', data_url: 'https://chatwoot.invalid/rails/active_storage/EJEMPLO.ogg', extension: 'ogg', transcribed_text: 'NO SE USA' }],
};

/** El toque de un botón (`input_select`). */
export const PAYLOAD_DOC_BOTON = {
  ...PAYLOAD_DOC_MESSAGE_CREATED,
  id: 424244,
  content: 'Sí',
  content_attributes: { submitted_values: [{ title: 'Sí', value: 'ag|a|general|si' }] },
};
