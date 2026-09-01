// ============================================================
// WhatsApp Cloud API — Send Messages (D100)
// ============================================================

import { splitMessage } from './wa-format.ts';
import { aEspanolNeutro } from './es-neutro.ts';
import { registrarEnvio, resumenPayload } from './wa-envios.ts';
import type { EnvioCtx } from './wa-envios.ts';

export type { EnvioCtx } from './wa-envios.ts';

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

/**
 * Send a text message, auto-splitting if > 500 chars.
 * Pasa por el guard de espanol neutro: TODO lo que sale de cualquier bot de MeTRIK va en
 * tuteo colombiano, y eso se garantiza aqui y no en el prompt (ver es-neutro.ts).
 */
export async function sendTextMessage(phone: string, text: string, ctx: EnvioCtx = {}): Promise<void> {
  const neutro = aEspanolNeutro(text);
  if (neutro.correcciones.length) {
    console.warn(`[wa-respond] voseo corregido antes de enviar: ${neutro.correcciones.join(', ')}`);
  }
  const chunks = splitMessage(neutro.texto);
  for (const chunk of chunks) {
    // No artificial delay — Meta keeps ordering within a single phone_number_id.
    // Removing the 1s sleep shaves ~2-3s off multi-chunk flows (Sprint 1, Yuto).
    await postMessage(phone, {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: chunk },
    }, ctx);
  }
}

/** Send a numbered list as text (for menus with > 3 options) */
export async function sendNumberedMenu(
  phone: string,
  header: string,
  options: string[],
  ctx: EnvioCtx = {},
): Promise<void> {
  const numbered = options.map((opt, i) => `${i + 1}️⃣ ${opt}`).join('\n');
  const text = `${header}\n\n${numbered}\n\nResponde con el número.`;
  await sendTextMessage(phone, text, ctx);
}

/** Send interactive buttons (max 3 buttons) */
export async function sendButtons(
  phone: string,
  body: string,
  buttons: Array<{ id: string; title: string }>,
  ctx: EnvioCtx = {},
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
  }, ctx);
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
  ctx: EnvioCtx = {},
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
  }, ctx);
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
  ctx: EnvioCtx = {},
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
  }, ctx);
}

/**
 * Los `components` de una plantilla de Meta: el relleno de las variables del header, del
 * cuerpo y de los botones. Se tipa la envoltura, que es lo estable, y no cada parametro:
 * su forma depende del tipo (`text`, `currency`, `date_time`, `image`, ...) y cambia con
 * la version de la API. Ver docs de Cloud API, "Template Messages".
 */
export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  sub_type?: string;
  index?: string;
  parameters?: Array<Record<string, unknown>>;
}

/**
 * Envia una plantilla aprobada. Es el unico camino permitido para escribirle a alguien
 * FUERA de la ventana de 24h (contratos, avisos de cobro, primer contacto).
 *
 * Existe porque hasta ahora esos envios se hacian a mano contra la Graph API, por fuera
 * del codigo, y por eso no quedaba constancia de ninguno: el contrato de TERMOTECH SAS
 * (2026-08-31) salio asi. Mandarlo por aqui lo deja en `wa_envios` con su acuse.
 *
 * Devuelve el wamid, o null si Meta lo rechazo (plantilla no aprobada, pausada, numero
 * invalido). Un null aqui NO es un detalle de log: significa que el cliente no recibio nada.
 */
export async function sendTemplate(
  phone: string,
  templateName: string,
  languageCode: string,
  components: TemplateComponent[] = [],
  ctx: EnvioCtx = {},
): Promise<string | null> {
  return await postMessage(phone, {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length ? { components } : {}),
    },
  }, { ...ctx, origen: ctx.origen ?? 'template', templateName });
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
  } catch {
    // ignorar: el indicador es cosmetico, nunca debe romper la conversacion
  }
}

// ============================================================
// Ritmo humano (estandar para TODO bot conversacional de MeTRIK)
// ============================================================
//
// Un bot que contesta en 200 ms se lee como una maquina, y en una entrevista narrativa eso
// cambia lo que la persona cuenta. Dos piezas, y las dos son necesarias:
//   1. el indicador "escribiendo..." (`sendTypingIndicator`, ya existia y lo usan Venezuela y
//      Customer Service) — marca leido y pone los puntos;
//   2. una pausa proporcional a lo que se va a decir, que es lo que faltaba en todos los bots.
//
// La pausa se calcula, no se fija: un "listo" y un parrafo de tres lineas no pueden tardar lo
// mismo. Formula declarada abajo, con piso y techo.
//
// ⚠️ El techo es deliberadamente bajo (4,5 s). El webhook responde a Meta DESPUES de procesar,
// y Meta reintenta la entrega si el endpoint tarda demasiado — un reintento duplica mensajes,
// que es peor que sonar rapido. Para secuencias de varios mensajes seguidos, usar
// `enBackground()` y responder a Meta primero.
// Nota historica: en el Sprint 1 se quito un `sleep(1s)` de `sendTextMessage` porque servia
// para ordenar mensajes, cosa que Meta ya garantiza por `phone_number_id`. Esto NO lo revierte:
// aquello era latencia sin proposito, esto es ritmo deliberado y medido por longitud.

export interface RitmoOpts {
  pisoMs?: number;      // minimo, para que nada salga instantaneo
  porCharMs?: number;   // cuanto "tarda en escribir" cada caracter
  techoMs?: number;     // maximo, para no colgar el webhook
  waMessageId?: string; // si viene, muestra "escribiendo..." antes de la pausa
  sinRitmo?: boolean;   // apagado explicito (pruebas, cargas masivas)
}

const RITMO_DEFAULT: Required<Pick<RitmoOpts, 'pisoMs' | 'porCharMs' | 'techoMs'>> = {
  pisoMs: 900,
  porCharMs: 22,
  techoMs: 4500,
};

/** Pausa que "tardaria" una persona en escribir este texto. Pura y testeable. */
export function calcularPausaMs(text: string, opts: RitmoOpts = {}): number {
  const { pisoMs, porCharMs, techoMs } = { ...RITMO_DEFAULT, ...opts };
  const largo = (text || '').length;
  return Math.min(Math.max(pisoMs, largo * porCharMs), techoMs);
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envia un texto con ritmo humano: "escribiendo..." + pausa proporcional + mensaje.
 * Es el camino por defecto para hablarle a una persona; `sendTextMessage` queda para
 * avisos del sistema y para cuando la inmediatez es lo correcto.
 */
export async function sendTextWithRhythm(
  phone: string,
  text: string,
  opts: RitmoOpts = {},
  ctx: EnvioCtx = {},
): Promise<void> {
  if (opts.sinRitmo || Deno.env.get('WA_RITMO_HUMANO') === 'off') {
    await sendTextMessage(phone, text, ctx);
    return;
  }
  if (opts.waMessageId) await sendTypingIndicator(opts.waMessageId);
  await dormir(calcularPausaMs(text, opts));
  await sendTextMessage(phone, text, ctx);
}

/**
 * Corre trabajo DESPUES de responderle a Meta, sin perderlo. Obligatorio para secuencias de
 * varios mensajes con ritmo: si se hace antes de responder, el webhook tarda y Meta reintenta.
 * Sin `waitUntil` el worker puede reciclarse a mitad y el trabajo se pierde en silencio (ya
 * paso con meta-leads-webhook: 18 de 153 leads).
 */
// deno-lint-ignore no-explicit-any
export function enBackground(p: Promise<unknown>): void {
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
  else void p.catch((e) => console.error('[wa-respond] trabajo en background fallo:', e));
}

/** Envia una tarjeta de contacto (vCard) para que el usuario pueda reenviarla con un toque. */
export async function sendContact(
  phone: string,
  displayName: string,
  contactPhone: string,
  ctx: EnvioCtx = {},
): Promise<void> {
  const digits = (contactPhone || '').replace(/\D/g, '');
  if (!digits) return;
  await postMessage(phone, {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'contacts',
    contacts: [{
      name: { formatted_name: displayName, first_name: displayName },
      phones: [{ phone: `+${digits}`, type: 'WORK', wa_id: digits }],
    }],
  }, ctx);
}

/** Pide la ubicacion con el boton nativo "Enviar ubicacion" de WhatsApp (in-chat). */
export async function sendLocationRequest(phone: string, body: string, ctx: EnvioCtx = {}): Promise<void> {
  await postMessage(phone, {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'interactive',
    interactive: {
      type: 'location_request_message',
      body: { text: (body || '').slice(0, 1024) },
      action: { name: 'send_location' },
    },
  }, ctx);
}

// --- Internal ---

/**
 * Unica puerta de salida a la Graph API, y por eso el unico lugar sensato para dejar
 * constancia: un sender nuevo queda auditado sin que su autor se acuerde de hacerlo.
 *
 * Devuelve el wamid porque es la llave con la que despues se cruzan los acuses
 * ('sent' / 'delivered' / 'read' / 'failed') que Meta manda al webhook. Antes esta
 * funcion leia la respuesta solo cuando fallaba y botaba el id: sin el, un acuse que
 * llega no tiene contra que cruzarse y no dice de que mensaje habla.
 */
async function postMessage(
  phone: string,
  payload: Record<string, unknown>,
  ctx: EnvioCtx = {},
): Promise<string | null> {
  const preview = resumenPayload(payload);
  let res: Response;
  try {
    res = await fetch(getMetaUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Se registra el intento fallido ANTES de propagar: el error sigue subiendo como
    // siempre, pero ya no se va sin dejar rastro.
    await registrarEnvio(phone, null, preview, ctx);
    throw err;
  }

  const cuerpo = await res.text();
  if (!res.ok) {
    console.error(`[wa-respond] Failed to send to ${phone}: ${res.status} ${cuerpo}`);
    await registrarEnvio(phone, null, preview, ctx);
    return null;
  }

  let waMessageId: string | null = null;
  try {
    waMessageId = JSON.parse(cuerpo)?.messages?.[0]?.id ?? null;
  } catch {
    console.error(`[wa-respond] respuesta de Meta sin JSON para ${phone}: ${cuerpo.slice(0, 200)}`);
  }
  await registrarEnvio(phone, waMessageId, preview, ctx);
  return waMessageId;
}
