// ============================================================
// wa-webhook-payload — lectura del webhook de Meta, sin I/O
// ------------------------------------------------------------
// Vive aparte de `wa-webhook/index.ts` porque ese archivo no se puede importar desde vitest
// (`wa-parse.ts` lee `Deno.env` al cargar). Aqui no se lee `Deno.env`, no se habla con la red y
// no se importa nada del bot: el `phone_number_id` propio entra por parametro.
//
// ⚠️ Por que existe (2026-09-15): desde abril de 2026 Meta manda el BSUID del remitente
// (`messages[].from_user_id`, `contacts[].user_id`) y OMITE `messages[].from` y
// `contacts[].wa_id` cuando la persona activo nombre de usuario de WhatsApp, salvo que el numero
// del negocio le haya escrito o recibido algo en los ultimos 30 dias, o que este en la libreta
// de contactos. El webhook tomaba `phone = msg.from` sin mirar, y un cliente (4D SOFT) revento en
// `identifyUser` con `Cannot read properties of undefined (reading 'replace')`: su mensaje no se
// registro, no se le contesto y nadie se entero.
//
// Fuente: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids/
// (secciones "Phone numbers", "Incoming messages webhooks" y "Status messages webhooks").
//
// La salida separa los dos casos POR TIPO: un mensaje sin telefono nunca se construye como
// `IncomingMessage`, asi que no puede llegar a ninguna funcion que asuma que el telefono existe.
// ============================================================

import type { IncomingMessage } from './types.ts';
import type { StatusEntrega } from './wa-envios.ts';

// Forma del webhook de Meta, limitada a lo que se lee aqui. Todo lo que identifica al remitente
// va opcional: `from` y `wa_id` pueden faltar, y `from_user_id` es nuevo.
export type MetaMensaje = {
  from?: string;
  from_user_id?: string;  // BSUID. Llega siempre, tenga o no nombre de usuario.
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { id?: string; caption?: string };
  audio?: { id?: string };
  interactive?: {
    type?: string;
    nfm_reply?: { response_json?: string };
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  // wamid del mensaje nuestro al que responde (en toques de boton, el mensaje con los botones).
  // `forwarded` / `frequently_forwarded`: Meta los pone cuando el usuario REENVIA un mensaje.
  // Hasta la bandeja de solicitudes nadie los leia y un reenvio llegaba como texto suelto.
  context?: { from?: string; id?: string; forwarded?: boolean; frequently_forwarded?: boolean };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  // Tarjeta de contacto compartida (o el boton REQUEST_CONTACT_INFO).
  contacts?: Array<{ phones?: Array<{ phone?: string; wa_id?: string }> }>;
};

export type MetaContacto = {
  profile?: { name?: string; username?: string };
  wa_id?: string;    // se omite cuando `from` tambien se omite
  user_id?: string;  // BSUID
};

// Acuse de entrega de un mensaje que MeTRIK mando. Llega por el mismo webhook que los
// mensajes entrantes, en `value.statuses` en vez de `value.messages`.
export type MetaStatus = {
  id?: string;                 // wamid del mensaje NUESTRO al que se refiere
  status?: string;             // sent | delivered | read | failed
  timestamp?: string;          // epoch en segundos, como string
  recipient_id?: string;       // telefono del destinatario. Se puede omitir (ver cabecera).
  recipient_user_id?: string;  // BSUID del destinatario. Se omite en un `failed` enviado a telefono.
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};

export type MetaWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: MetaContacto[];
        messages?: MetaMensaje[];
        statuses?: MetaStatus[];
      };
    }>;
  }>;
};

/**
 * Un mensaje de alguien de quien Meta no mando el telefono. Lo unico que se puede hacer con el
 * es contestarle por su BSUID, dejarlo registrado y avisar a quien opera: el resto del bot
 * (usuarios, sesiones, Cardumen, aceptaciones) esta indexado por telefono.
 */
export interface MensajeSinTelefono {
  /** BSUID (`CO.1234...`). Es a lo que se le puede responder. */
  user_id: string;
  /** Sin la arroba, tal como llega en `contacts[].profile.username`. */
  username?: string;
  /** Nombre de perfil de WhatsApp. */
  nombre?: string;
  /** `messages[].type` tal como llego, incluidos los tipos que el bot no atiende. */
  tipo: string;
  /** Lo legible del mensaje: el texto, el pie de la foto, el boton tocado o los numeros compartidos. */
  texto: string;
  wa_message_id?: string;
  timestamp?: string;
}

export type Entrante =
  | { tipo: 'con_telefono'; mensaje: IncomingMessage }
  | { tipo: 'sin_telefono'; mensaje: MensajeSinTelefono };

/** Los unicos que la tabla `wa_envios` acepta. Ver el CHECK de la migracion 20260901000003. */
export const STATUS_CONOCIDOS = ['sent', 'delivered', 'read', 'failed'];

/** Texto no vacio, recortado. Lo demas cuenta como ausente. */
function presente(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

/**
 * Saca los acuses de entrega del payload.
 *
 * Recorre TODAS las entries y changes, no solo la primera: Meta agrupa varios acuses en
 * un mismo webhook cuando salieron varios mensajes seguidos (un texto largo se parte en
 * chunks y cada chunk trae el suyo). Quedarse con `[0]` perderia el resto en silencio.
 *
 * `phone` sale de `recipient_id` y, si falta, del BSUID (`recipient_user_id`): un mensaje que se
 * mando a un BSUID no trae telefono, y sin esto su acuse quedaria sin destinatario.
 */
export function extraerStatuses(
  payload: MetaWebhookPayload,
  propioPhoneNumberId?: string,
): StatusEntrega[] {
  const salida: StatusEntrega[] = [];
  try {
    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value;
        if (!value?.statuses?.length) continue;

        // Lo que sea de otro numero (Mi Bolsillo) no es nuestro.
        const recibido = value?.metadata?.phone_number_id;
        if (propioPhoneNumberId && recibido && recibido !== propioPhoneNumberId) continue;

        for (const st of value.statuses) {
          if (!st?.id || !st?.status) continue;
          // La tabla acota los estados con un CHECK. Un valor que Meta agregue manana
          // haria fallar el insert entero, asi que aqui se filtra y se deja dicho en el
          // log: mejor un acuse que no se entiende visible, que un error de constraint.
          if (!STATUS_CONOCIDOS.includes(st.status)) {
            console.warn(`[wa-webhook] status desconocido de Meta: ${st.status} (${st.id})`);
            continue;
          }
          const err = st.errors?.[0];
          salida.push({
            waMessageId: st.id,
            status: st.status,
            statusAt: st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : undefined,
            phone: presente(st.recipient_id) ?? presente(st.recipient_user_id),
            errorCode: err?.code,
            errorTitle: err?.title ?? err?.message,
          });
        }
      }
    }
  } catch (err) {
    console.error('[wa-webhook] no se pudieron leer los statuses:', err);
  }
  return salida;
}

/**
 * Saca el mensaje entrante del payload y decide si trae telefono.
 *
 * El telefono sale de `messages[0].from` y, si falta, de `contacts[0].wa_id` (solo si ese
 * contacto es el mismo remitente). Si no hay ninguno de los dos pero hay BSUID, sale como
 * `sin_telefono`. Sin telefono ni BSUID no hay a quien contestarle: `null`.
 *
 * Con telefono, un tipo que el bot no atiende (documento, sticker, video) sigue devolviendo
 * `null`, como siempre. Sin telefono se entrega igual: es lo que permite contestarle y avisar
 * aunque mande una tarjeta de contacto, que es justo lo que se le va a pedir.
 */
export function extraerEntrante(
  payload: MetaWebhookPayload,
  propioPhoneNumberId?: string,
): Entrante | null {
  try {
    const value = payload?.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg) return null;

    // Ignore messages sent to other phone numbers (e.g. Mi Bolsillo)
    const recibido = value?.metadata?.phone_number_id;
    if (propioPhoneNumberId && recibido && recibido !== propioPhoneNumberId) {
      console.log(`[wa-webhook] Ignoring message for phone_number_id ${recibido} (not ours: ${propioPhoneNumberId})`);
      return null;
    }

    const bsuid = presente(msg.from_user_id) ?? presente(value?.contacts?.[0]?.user_id);
    const contacto = contactoDelRemitente(value?.contacts, bsuid);
    const username = presente(contacto?.profile?.username);
    const telefono = presente(msg.from) ?? presente(contacto?.wa_id);

    if (!telefono) {
      if (!bsuid) {
        console.warn(`[wa-webhook] mensaje sin telefono ni BSUID (${msg.type ?? 'sin tipo'}, ${msg.id ?? 'sin id'}): no hay a quien contestarle`);
        return null;
      }
      return {
        tipo: 'sin_telefono',
        mensaje: {
          user_id: bsuid,
          username,
          nombre: presente(contacto?.profile?.name),
          tipo: msg.type ?? 'desconocido',
          texto: textoLegible(msg),
          wa_message_id: msg.id,
          timestamp: msg.timestamp,
        },
      };
    }

    const mensaje = mensajeConTelefono(msg, telefono, value?.metadata?.display_phone_number);
    if (!mensaje) return null;
    // El wamid va en TODOS los tipos: la bandeja lo usa para no guardar dos veces lo que Meta
    // reintenta, y la foto y el toque de boton no lo traian.
    if (msg.id && !mensaje.wa_message_id) mensaje.wa_message_id = msg.id;
    // Solo cuando es cierto: asi un mensaje normal sale identico a como salia antes.
    if (msg.context?.forwarded === true || msg.context?.frequently_forwarded === true) mensaje.reenviado = true;
    if (msg.context?.frequently_forwarded === true) mensaje.reenviado_muchas_veces = true;
    if (bsuid) mensaje.user_id = bsuid;
    if (username) mensaje.username = username;
    return { tipo: 'con_telefono', mensaje };
  } catch (err) {
    console.error('[wa-webhook] no se pudo leer el mensaje entrante:', err);
    return null;
  }
}

/**
 * El contacto que describe al remitente. En un chat 1:1 hay uno solo; si trae BSUID y no coincide
 * con el del mensaje, no se usa: tomar el `wa_id` de otra persona seria atenderla con el numero
 * equivocado.
 */
function contactoDelRemitente(contactos: MetaContacto[] | undefined, bsuid: string | undefined): MetaContacto | undefined {
  const c = contactos?.[0];
  if (!c) return undefined;
  const suyo = presente(c.user_id);
  if (bsuid && suyo && suyo !== bsuid) return undefined;
  return c;
}

/** Lo que una persona leeria del mensaje. Para el aviso interno y la bitacora. */
export function textoLegible(msg: MetaMensaje): string {
  const texto = presente(msg.text?.body)
    ?? presente(msg.image?.caption)
    ?? presente(msg.interactive?.button_reply?.title)
    ?? presente(msg.interactive?.list_reply?.title);
  if (texto) return texto;
  if (msg.type === 'contacts') {
    const numeros = (msg.contacts ?? [])
      .flatMap((c) => c.phones ?? [])
      .map((p) => presente(p.phone) ?? presente(p.wa_id))
      .filter((n): n is string => !!n);
    return numeros.length ? `[contacto compartido] ${numeros.join(', ')}` : '[contacto compartido]';
  }
  if (msg.type === 'location' && msg.location) {
    return `[ubicacion] ${msg.location.name ?? msg.location.address ?? `${msg.location.latitude},${msg.location.longitude}`}`;
  }
  return `[${msg.type ?? 'desconocido'}]`;
}

/** El mensaje de siempre, con su telefono. `null` para los tipos que el bot no atiende. */
function mensajeConTelefono(msg: MetaMensaje, phone: string, botPhone: string | undefined): IncomingMessage | null {
  const timestamp = msg.timestamp ?? '';

  if (msg.type === 'text' && msg.text) {
    return {
      phone,
      text: msg.text.body ?? '',
      type: 'text',
      wa_message_id: msg.id,
      bot_phone: botPhone,
      timestamp,
    };
  }

  if (msg.type === 'image') {
    return {
      phone,
      text: msg.image?.caption || '',
      type: 'image',
      image_id: msg.image?.id,
      timestamp,
    };
  }

  if (msg.type === 'audio') {
    return {
      phone,
      text: '',
      type: 'audio',
      audio_id: msg.audio?.id,
      wa_message_id: msg.id,
      bot_phone: botPhone,
      timestamp,
    };
  }

  if (msg.type === 'interactive') {
    // Flow completado → llega como nfm_reply con response_json (datos del cuestionario Cardumen).
    if (msg.interactive?.type === 'nfm_reply' || msg.interactive?.nfm_reply) {
      return {
        phone,
        text: '',
        type: 'flow_response',
        flow_response: msg.interactive?.nfm_reply?.response_json || '',
        timestamp,
      };
    }
    const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
    return {
      phone,
      text: reply?.title || reply?.id || '',
      type: 'interactive',
      interactive_reply: reply?.id,
      timestamp,
      // Crudo, para el flujo de aceptacion de terminos (id del toque, context.id, timestamp).
      meta_mensaje: msg as unknown as Record<string, unknown>,
    };
  }

  if (msg.type === 'location' && msg.location) {
    return {
      phone,
      text: '',
      type: 'location',
      location: {
        latitude: msg.location.latitude,
        longitude: msg.location.longitude,
        name: msg.location.name,
        address: msg.location.address,
      },
      wa_message_id: msg.id,
      bot_phone: botPhone,
      timestamp,
    };
  }

  // Unsupported message type
  return null;
}
