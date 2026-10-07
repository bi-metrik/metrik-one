// ============================================================
// wa_conversacion — la conversación completa del bot con el equipo (2026-10-06)
// ------------------------------------------------------------
// Diseño: proyectos/trappvel/clarity/docs/diseno/2026-10-06_investigacion-agentes-conversacionales.md (§2.4, §3.2).
// Migración: 20261006213100_wa_conversacion.sql.
//
// Lo que entra lo escribe el webhook (`registrarEntrante`) después de identificar al remitente y de la puerta del aviso
// de datos. Lo que sale lo escribe `postMessage` (`wa-respond.ts`) por la RPC `wa_conversacion_registrar_saliente`, que
// solo guarda si ese teléfono tiene un entrante en las últimas 24 h.
//
// Regla dura, la misma de `wa-envios.ts`: registrar es telemetría. Nada de lo que hace este módulo puede tumbar un
// mensaje ni un envío; cada función atrapa su error y lo escribe en consola.
//
// Puro respecto de Deno: recibe el cliente, así se prueba desde vitest.
// ============================================================

import type { IncomingMessage, WaUser } from './types.ts';
import { LLAVE_BANDEJA } from './wa-bandeja-reglas.ts';

// deno-lint-ignore no-explicit-any
type Cliente = { from: (tabla: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export const TABLA_CONVERSACION = 'wa_conversacion';
export const TEXTO_MAXIMO = 20000;

/** Errores de «la tabla o la función todavía no existe» (migración sin aplicar): no se reportan en cada mensaje. */
const SIN_TABLA = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);

export type ClaseEntrante = 'escrito' | 'reenvio' | 'toque' | 'audio' | 'imagen' | 'ubicacion' | 'otro';
export type FormatoSaliente = 'texto' | 'botones' | 'lista' | 'plantilla' | 'documento' | 'otro';

export interface OpcionGuardada {
  id: string;
  titulo: string;
  descripcion?: string;
}

/** Solo dígitos: la misma llave en las dos direcciones (la RPC normaliza igual). */
export function soloDigitos(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

/**
 * ¿Se guarda la conversación de este remitente? Solo en los workspaces con la bandeja de solicitudes encendida o con el
 * bot conversacional configurado (cualquier objeto en `config_extra.bot_conversacional`, prendido o no): es la superficie
 * donde el núcleo conversacional va a leerla. El resto del bot (gastos de SOENA, etc.) no deja texto completo aquí.
 */
export function conversacionActiva(user: Pick<WaUser, 'modulos'> | null | undefined): boolean {
  const m = user?.modulos;
  if (!m) return false;
  const modules = (m.modules ?? null) as Record<string, unknown> | null;
  if (modules && modules[LLAVE_BANDEJA] === true) return true;
  const bot = m.bot_conversacional;
  return !!bot && typeof bot === 'object' && !Array.isArray(bot);
}

/** Qué es lo que llegó. Un reenvío gana a todo: lo reenviado es dato del cliente, aunque sea un audio. */
export function claseDelEntrante(message: Pick<IncomingMessage, 'type' | 'reenviado'>): ClaseEntrante {
  if (message.reenviado === true) return 'reenvio';
  switch (message.type) {
    case 'text': return 'escrito';
    case 'interactive':
    case 'button': return 'toque';
    case 'audio': return 'audio';
    case 'image': return 'imagen';
    case 'location': return 'ubicacion';
    default: return 'otro';
  }
}

/** El wamid del mensaje que tenía el botón tocado (`context.id` del mensaje crudo de Meta). */
function contextoDelToque(message: IncomingMessage): string | null {
  const ctx = (message.meta_mensaje as { context?: { id?: unknown } } | undefined)?.context;
  return typeof ctx?.id === 'string' && ctx.id ? ctx.id : null;
}

function textoDeUbicacion(message: IncomingMessage): string | null {
  const l = message.location;
  if (!l) return null;
  return `[ubicación] ${l.name ?? l.address ?? `${l.latitude},${l.longitude}`}`;
}

/** La fila de un mensaje entrante, tal como se inserta. Pura. */
export function filaEntrante(user: Pick<WaUser, 'workspace_id'>, message: IncomingMessage): Record<string, unknown> {
  const clase = claseDelEntrante(message);
  const texto = message.type === 'location' ? textoDeUbicacion(message) : ((message.text ?? '').trim() || null);
  const media = message.type === 'audio' && message.audio_id
    ? { tipo: 'audio', id: message.audio_id }
    : message.type === 'image' && message.image_id
      ? { tipo: 'imagen', id: message.image_id }
      : null;
  const esToque = message.type === 'interactive' || message.type === 'button';
  return {
    workspace_id: user.workspace_id,
    phone: soloDigitos(message.phone),
    direccion: 'entrante',
    clase,
    texto: texto ? texto.slice(0, TEXTO_MAXIMO) : null,
    toque_id: esToque ? (message.interactive_reply ?? null) : null,
    contexto_wamid: esToque ? contextoDelToque(message) : null,
    media,
    wa_message_id: message.wa_message_id ?? null,
  };
}

/**
 * Guarda lo que llegó. Un duplicado de Meta (mismo wamid) choca con el índice único y no se repite. Nunca lanza.
 * Devuelve si se guardó una fila nueva.
 */
export async function registrarEntrante(supabase: Cliente, user: WaUser, message: IncomingMessage): Promise<boolean> {
  if (!conversacionActiva(user)) return false;
  try {
    const { error } = await supabase.from(TABLA_CONVERSACION).insert(filaEntrante(user, message));
    if (!error) return true;
    // 23505: el mismo wamid otra vez (reintento de Meta). Tabla sin crear (migración sin aplicar): se calla.
    if (error.code !== '23505' && !SIN_TABLA.has(error.code)) console.error('[wa-conversacion] no se pudo guardar el entrante:', error.message);
    return false;
  } catch (err) {
    console.error('[wa-conversacion] no se pudo guardar el entrante:', err);
    return false;
  }
}

/**
 * Un audio se guarda al llegar sin texto; cuando se transcribe, la transcripción completa el mismo renglón. Nunca lanza.
 * Si no hay fila (workspace sin conversación), el update no toca nada.
 */
export async function completarTexto(supabase: Cliente, waMessageId: string | null | undefined, texto: string): Promise<void> {
  if (!waMessageId || !texto.trim()) return;
  try {
    const { error } = await supabase
      .from(TABLA_CONVERSACION)
      .update({ texto: texto.slice(0, TEXTO_MAXIMO) })
      .eq('wa_message_id', waMessageId)
      .is('texto', null);
    if (error && !SIN_TABLA.has(error.code)) console.error('[wa-conversacion] no se pudo guardar la transcripción:', error.message);
  } catch (err) {
    console.error('[wa-conversacion] no se pudo guardar la transcripción:', err);
  }
}

// ------------------------------------------------------------
// Lo que sale
// ------------------------------------------------------------

export interface Saliente {
  texto: string;
  formato: FormatoSaliente;
  opciones: OpcionGuardada[] | null;
}

/**
 * Lo que el usuario vio de un payload de la Graph API: el texto completo y, si es interactivo, sus opciones en orden.
 * `previewSecreto` (el `ctx.preview` de un envío con una llave) reemplaza el texto: el secreto nunca se guarda. Pura.
 */
export function salienteDelPayload(payload: Record<string, unknown>, previewSecreto?: string): Saliente {
  const tipo = String(payload.type ?? '');
  if (tipo === 'text') {
    const body = (payload.text as { body?: string } | undefined)?.body ?? '';
    return { texto: previewSecreto ?? body, formato: 'texto', opciones: null };
  }
  if (tipo === 'interactive') {
    const i = payload.interactive as {
      type?: string;
      body?: { text?: string };
      action?: {
        buttons?: Array<{ reply?: { id?: string; title?: string } }>;
        sections?: Array<{ rows?: Array<{ id?: string; title?: string; description?: string }> }>;
        button?: string;
      };
    } | undefined;
    const cuerpo = previewSecreto ?? i?.body?.text ?? '';
    if (i?.type === 'button') {
      const opciones = (i.action?.buttons ?? []).map((b) => ({ id: b.reply?.id ?? '', titulo: b.reply?.title ?? '' }));
      return { texto: cuerpo, formato: 'botones', opciones };
    }
    if (i?.type === 'list') {
      const opciones = (i.action?.sections ?? []).flatMap((s) => s.rows ?? []).map((r) => ({
        id: r.id ?? '',
        titulo: r.title ?? '',
        ...(r.description ? { descripcion: r.description } : {}),
      }));
      return { texto: cuerpo, formato: 'lista', opciones };
    }
    return { texto: cuerpo || `[${i?.type ?? 'interactive'}]`, formato: 'otro', opciones: null };
  }
  if (tipo === 'template') {
    const name = (payload.template as { name?: string } | undefined)?.name ?? '?';
    return { texto: previewSecreto ?? `[plantilla ${name}]`, formato: 'plantilla', opciones: null };
  }
  if (tipo === 'document') {
    const d = payload.document as { filename?: string; caption?: string } | undefined;
    return { texto: previewSecreto ?? [`[documento] ${d?.filename ?? ''}`.trim(), d?.caption ?? ''].filter(Boolean).join('\n'), formato: 'documento', opciones: null };
  }
  return { texto: previewSecreto ?? `[${tipo || 'desconocido'}]`, formato: 'otro', opciones: null };
}

/**
 * Guarda un envío aceptado por Meta. La RPC decide si el teléfono tiene conversación (entrante en 24 h); si no, no
 * escribe. Nunca lanza.
 */
export async function registrarSaliente(
  supabase: Cliente,
  phone: string,
  waMessageId: string | null,
  payload: Record<string, unknown>,
  ctx: { origen?: string; intent?: string; preview?: string } = {},
): Promise<void> {
  try {
    const s = salienteDelPayload(payload, ctx.preview);
    const { error } = await supabase.rpc('wa_conversacion_registrar_saliente', {
      p_phone: phone,
      p_wa_message_id: waMessageId,
      p_texto: s.texto.slice(0, TEXTO_MAXIMO),
      p_formato: s.formato,
      p_opciones: s.opciones,
      p_origen: ctx.origen ?? 'bot',
      p_intent: ctx.intent ?? null,
    });
    if (error && !SIN_TABLA.has(error.code)) console.error('[wa-conversacion] no se pudo guardar el saliente:', error.message);
  } catch (err) {
    console.error('[wa-conversacion] no se pudo guardar el saliente:', err);
  }
}
