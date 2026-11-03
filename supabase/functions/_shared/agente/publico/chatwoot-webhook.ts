// ============================================================
// Asistente público — el webhook del Agent Bot de Chatwoot: firma, lectura del payload y filtros (§3)
// ------------------------------------------------------------
// Módulo PURO (sin `Deno.env` ni red): lo usan la función `chatwoot-agente` y las pruebas.
//
// Firma (§3.3): `X-Chatwoot-Signature` = `sha256=` + HMAC-SHA256 del secreto sobre `"{timestamp}.{cuerpo crudo}"`, con
// `X-Chatwoot-Timestamp` en segundos. Ventana de 5 minutos. Comparación en tiempo constante. Sin secreto: se rechaza
// (falla cerrado, como `wa-firma.ts`).
//
// Filtros (§3.2, todos obligatorios): evento `message_created` (o `message_updated` solo si trae audio), mensaje
// entrante, no privado, de un contacto, conversación en `pending`, inbox registrado del workspace.
//
// SIN VERIFICAR hasta el payload real del 22-oct (el fixture de las pruebas está armado de la documentación y marcado):
//   · si `message_type` llega como texto («incoming») o entero (0): se aceptan los dos;
//   · el nombre exacto del tipo de remitente: se lee `sender.type` y `sender_type`; si no llega ninguno, cuenta el
//     tipo de mensaje (en Chatwoot los entrantes son del contacto) y queda marcado `remitenteSinTipo`;
//   · el campo de la URL del audio (`attachments[].data_url`) y el tipo (`file_type`).
// ============================================================

import type { Canal } from './tipos.ts';

export const VENTANA_FIRMA_S = 5 * 60;
const PREFIJO = 'sha256=';

function hex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}

function igualesEnTiempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function firmaChatwoot(secreto: string, timestamp: string, cuerpo: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return PREFIJO + hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${cuerpo}`))));
}

export type ResultadoFirma = { ok: true } | { ok: false; motivo: 'sin_secreto' | 'sin_firma' | 'sin_timestamp' | 'vieja' | 'distinta' };

/** Verifica firma y antigüedad. `ahoraS` en segundos. Pura salvo WebCrypto. */
export async function verificarFirmaChatwoot(p: {
  secreto: string | undefined;
  firma: string | null;
  timestamp: string | null;
  cuerpo: string;
  ahoraS: number;
}): Promise<ResultadoFirma> {
  if (!p.secreto) return { ok: false, motivo: 'sin_secreto' };
  if (!p.firma || !p.firma.startsWith(PREFIJO) || p.firma.length !== PREFIJO.length + 64) return { ok: false, motivo: 'sin_firma' };
  if (!p.timestamp || !/^\d{9,11}$/.test(p.timestamp)) return { ok: false, motivo: 'sin_timestamp' };
  if (Math.abs(p.ahoraS - Number(p.timestamp)) > VENTANA_FIRMA_S) return { ok: false, motivo: 'vieja' };
  const calculada = await firmaChatwoot(p.secreto, p.timestamp, p.cuerpo);
  return igualesEnTiempoConstante(calculada, p.firma.toLowerCase()) ? { ok: true } : { ok: false, motivo: 'distinta' };
}

// ── El payload ───────────────────────────────────────────────────────────────

export interface AdjuntoChatwoot {
  tipo: string;
  url: string | null;
  extension: string | null;
}

export interface MensajeChatwoot {
  evento: string;
  mensajeId: number | null;
  cuentaId: number | null;
  conversacionId: number | null;
  inboxId: number | null;
  estadoConversacion: string | null;
  /** `Channel::Instagram`, `Channel::Whatsapp`, … */
  canalChatwoot: string | null;
  entrante: boolean;
  privado: boolean;
  /** `contact`, `user`, `agent_bot`… o null si el payload no lo trae. */
  tipoRemitente: string | null;
  remitenteSinTipo: boolean;
  nombreRemitente: string | null;
  texto: string | null;
  adjuntos: AdjuntoChatwoot[];
  /** El mensaje es de un tipo que el canal no deja leer (TikTok: audio y stickers). */
  noSoportado: boolean;
  /** El valor del botón tocado (`input_select`), si llegó. */
  valorBoton: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {});
const ent = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null);

/** Lee el payload del webhook. Nunca lanza: lo que no está queda en null. Pura. */
export function leerPayload(cuerpo: unknown): MensajeChatwoot {
  const p = obj(cuerpo);
  const conv = obj(p.conversation);
  const sender = obj(p.sender);
  const attrs = obj(p.content_attributes);
  const tipoMensaje = p.message_type;
  const entrante = tipoMensaje === 'incoming' || tipoMensaje === 0;
  const tipoRemitente = (str(sender.type) ?? str(p.sender_type))?.toLowerCase() ?? null;
  const adjuntos = (Array.isArray(p.attachments) ? p.attachments : []).map((a) => {
    const x = obj(a);
    // Chatwoot trae `transcribed_text` si su transcripción (OpenAI) está prendida: se ignora a propósito (§4.2, Anexo 5).
    return { tipo: String(x.file_type ?? '').toLowerCase(), url: str(x.data_url), extension: str(x.extension) };
  });
  const enviados = Array.isArray(attrs.submitted_values) ? attrs.submitted_values : [];
  const valorBoton = str(obj(enviados[0]).value);
  return {
    evento: String(p.event ?? ''),
    mensajeId: ent(p.id),
    cuentaId: ent(obj(p.account).id),
    conversacionId: ent(conv.id) ?? ent(conv.display_id),
    inboxId: ent(obj(p.inbox).id) ?? ent(conv.inbox_id),
    estadoConversacion: str(conv.status),
    canalChatwoot: str(conv.channel) ?? str(obj(p.inbox).channel_type),
    entrante,
    privado: p.private === true,
    tipoRemitente,
    remitenteSinTipo: tipoRemitente === null,
    nombreRemitente: str(sender.name),
    texto: typeof p.content === 'string' ? p.content : null,
    adjuntos,
    noSoportado: attrs.is_unsupported === true || p.content_type === 'unsupported',
    valorBoton,
  };
}

/**
 * Chatwoot resolvió la conversación: `conversation_status_changed` a `resolved` (ahí el payload ES la conversación, con
 * `id` = el número visible), o la actividad de `message_created` con la conversación ya `resolved`. null si no es eso. Pura.
 */
export function cierreDeChatwoot(cuerpo: unknown): { conversacionId: number; inboxId: number | null; cuentaId: number | null } | null {
  const p = obj(cuerpo);
  if (p.event === 'conversation_status_changed' && p.status === 'resolved') {
    const id = ent(p.id) ?? ent(p.display_id);
    return id === null ? null : { conversacionId: id, inboxId: ent(p.inbox_id), cuentaId: ent(obj(p.account).id) ?? ent(p.account_id) };
  }
  const conv = obj(p.conversation);
  if (p.event === 'message_created' && (p.message_type === 'activity' || p.message_type === 2) && conv.status === 'resolved') {
    const id = ent(conv.id) ?? ent(conv.display_id);
    return id === null ? null : { conversacionId: id, inboxId: ent(obj(p.inbox).id) ?? ent(conv.inbox_id), cuentaId: ent(obj(p.account).id) };
  }
  return null;
}

/** El canal desde el tipo de canal de Chatwoot (si el inbox no lo declara en la configuración). Pura. */
export function canalDeChatwoot(c: string | null): Canal {
  const t = (c ?? '').toLowerCase();
  if (t.includes('instagram')) return 'instagram';
  if (t.includes('tiktok')) return 'tiktok';
  if (t.includes('whatsapp')) return 'whatsapp';
  return 'otro';
}

export function tieneAudio(m: Pick<MensajeChatwoot, 'adjuntos'>): boolean {
  return m.adjuntos.some((a) => a.tipo === 'audio');
}

export type Filtro =
  | { pasa: true }
  | { pasa: false; motivo: 'evento' | 'saliente' | 'privado' | 'remitente' | 'no_pending' | 'inbox' | 'cuenta' | 'incompleto' };

/**
 * Los filtros de §3.2, en orden. `inboxes`: los registrados del workspace; `cuentaId`: la de su configuración.
 * Lo que no pasa se contesta 200 y se ignora. Pura.
 */
export function filtrar(m: MensajeChatwoot, o: { inboxes: number[]; cuentaId: number | null }): Filtro {
  const evento = m.evento === 'message_created' || (m.evento === 'message_updated' && tieneAudio(m));
  if (!evento) return { pasa: false, motivo: 'evento' };
  if (m.mensajeId === null || m.cuentaId === null || m.conversacionId === null) return { pasa: false, motivo: 'incompleto' };
  if (!m.entrante) return { pasa: false, motivo: 'saliente' };
  if (m.privado) return { pasa: false, motivo: 'privado' };
  if (m.tipoRemitente !== null && m.tipoRemitente !== 'contact') return { pasa: false, motivo: 'remitente' };
  if (m.estadoConversacion !== 'pending') return { pasa: false, motivo: 'no_pending' };
  if (o.cuentaId === null || m.cuentaId !== o.cuentaId) return { pasa: false, motivo: 'cuenta' };
  if (m.inboxId === null || !o.inboxes.includes(m.inboxId)) return { pasa: false, motivo: 'inbox' };
  return { pasa: true };
}

/** La clase de la fila entrante. Pura. */
export function claseEntrante(m: MensajeChatwoot): 'escrito' | 'toque' | 'audio' | 'imagen' | 'otro' {
  if (m.valorBoton) return 'toque';
  if (tieneAudio(m) || (m.noSoportado && !m.texto)) return 'audio';
  if (m.adjuntos.some((a) => a.tipo === 'image')) return m.texto ? 'escrito' : 'imagen';
  if (m.texto && m.texto.trim()) return 'escrito';
  return 'otro';
}

/** La clave de deduplicación en `claves_idempotencia` (§3.3). Pura. */
export function claveDeduplicacion(m: Pick<MensajeChatwoot, 'cuentaId' | 'mensajeId' | 'evento'>): string {
  // `message_updated` (el audio) es otro evento del mismo mensaje: se deduplica aparte.
  return `chatwoot:${m.evento === 'message_updated' ? 'act' : 'msg'}:${m.cuentaId}:${m.mensajeId}`;
}
