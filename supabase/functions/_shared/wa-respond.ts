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
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await delay(1000); // 1s delay between chunks (D100)
    await postMessage(phone, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: chunks[i] },
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
