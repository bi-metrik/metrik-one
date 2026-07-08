// ============================================================
// WhatsApp Cloud API — Send Messages (D100)
// ============================================================

import { splitMessage } from './wa-format.ts';

const META_API_VERSION = 'v21.0';

function getMetaUrl(): string {
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;
  return `https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`;
}

function getHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${Deno.env.get('WHATSAPP_ACCESS_TOKEN')}`,
    'Content-Type': 'application/json',
  };
}

/** Send a text message, auto-splitting if > 500 chars */
export async function sendTextMessage(phone: string, text: string): Promise<void> {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    // No artificial delay — Meta keeps ordering within a single phone_number_id.
    // Removing the 1s sleep shaves ~2-3s off multi-chunk flows (Sprint 1, Yuto).
    await postMessage(phone, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: chunk },
    });
  }
}

/** Send a numbered list as text (for menus with > 3 options) */
export async function sendNumberedMenu(phone: string, header: string, options: string[]): Promise<void> {
  const numbered = options.map((opt, i) => `${i + 1}️⃣ ${opt}`).join('\n');
  const text = `${header}\n\n${numbered}\n\nResponde con el número.`;
  await sendTextMessage(phone, text);
}

/** Send interactive buttons (max 3 buttons) */
export async function sendButtons(
  phone: string,
  body: string,
  buttons: Array<{ id: string; title: string }>,
): Promise<void> {
  await postMessage(phone, {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.slice(0, 3).map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });
}

/**
 * Send an interactive CTA URL button (free-form, dentro de ventana 24h).
 * Es el tipo que dispara el In-App Browser de WhatsApp (abrir sin salir de la app)
 * para números habilitados — a diferencia de un link de texto plano, que abre el navegador externo.
 */
export async function sendCtaUrl(
  phone: string,
  body: string,
  displayText: string,
  url: string,
): Promise<void> {
  await postMessage(phone, {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'interactive',
    interactive: {
      type: 'cta_url',
      body: { text: body },
      action: {
        name: 'cta_url',
        parameters: { display_text: displayText.slice(0, 20), url },
      },
    },
  });
}

/**
 * Send an interactive Flow message (WhatsApp Flows — se renderiza DENTRO del chat, sin navegador).
 * Requiere un flow_id ya publicado (o draft para pruebas). flow_action 'navigate' abre en `screen`.
 */
export async function sendFlow(
  phone: string,
  body: string,
  cta: string,
  flowId: string,
  flowToken: string,
  firstScreen: string,
  mode: 'draft' | 'published' = 'published',
): Promise<void> {
  await postMessage(phone, {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'interactive',
    interactive: {
      type: 'flow',
      body: { text: body },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: flowToken,
          flow_id: flowId,
          flow_cta: cta.slice(0, 20),
          flow_action: 'navigate',
          flow_action_payload: { screen: firstScreen },
          mode,
        },
      },
    },
  });
}

/** Mark message as read */
export async function markAsRead(messageId: string): Promise<void> {
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;
  await fetch(`https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }),
  });
}

/**
 * Marca leido + muestra el indicador "escribiendo..." al usuario. Dura hasta 25s o hasta
 * que se envie el proximo mensaje. Fire-and-forget: si la WABA no soporta typing_indicator
 * la request falla en silencio (no rompe el turno). Usar antes de una respuesta que tarda.
 */
export async function sendTypingIndicator(messageId: string): Promise<void> {
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;
  try {
    await fetch(`https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      }),
    });
  } catch (_e) {
    // ignorar: el indicador es cosmetico, nunca debe romper la conversacion
  }
}

// --- Internal ---

async function postMessage(phone: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(getMetaUrl(), {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`[wa-respond] Failed to send to ${phone}: ${res.status} ${err}`);
  }
}
