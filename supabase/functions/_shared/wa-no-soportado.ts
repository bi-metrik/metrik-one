// ============================================================
// Lo que el bot no lee (video, sticker, tarjeta de contacto), 2026-10-21
// ------------------------------------------------------------
// Antes `wa-webhook-payload.ts` no construía estos mensajes y se perdían en silencio (lo mismo le pasaba al PDF del
// recibo de Uber del 2026-10-21, que hoy ya se recibe como `document`). Ahora llegan como `no_soportado` y el bot dice
// que no los puede leer y qué sí recibe.
//
// Dónde NO contesta: en un workspace con la bandeja de solicitudes (Trappvel), donde los comerciales reenvían ráfagas
// de la conversación con el cliente; un «no lo puedo leer» por cada sticker reenviado sería ruido. Ahí sigue como antes.
// Puro: se prueba sin red.
// ============================================================

import type { IncomingMessage, WaUser } from './types.ts';
import { LLAVE_BANDEJA } from './wa-bandeja-reglas.ts';
import { dominioDelAgente } from './agente/config.ts';

const QUE: Record<string, string> = {
  video: 'videos',
  sticker: 'stickers',
  contacts: 'tarjetas de contacto',
};

/** El texto para quien mandó algo que el bot no lee. Pura. */
export function textoNoSoportado(tipoMeta: string | null | undefined): string {
  const que = QUE[String(tipoMeta ?? '')] ?? 'ese tipo de mensaje';
  const extra = tipoMeta === 'contacts' ? ' Si quieres crear el contacto, escríbeme su nombre y su celular.' : '';
  return `No puedo leer ${que} por aquí. Si es el soporte de un gasto, mándamelo como foto o PDF; si es otra cosa, escríbemela o mándame un audio.${extra}`;
}

/** ¿Se le contesta? No en un workspace con la bandeja de solicitudes (ni con el agente de la bandeja). Pura. */
export function contestarNoSoportado(user: Pick<WaUser, 'modulos'>, message: Pick<IncomingMessage, 'phone' | 'reenviado'>): boolean {
  const m = user.modulos;
  const modules = (m?.modules ?? null) as Record<string, unknown> | null;
  if (modules && modules[LLAVE_BANDEJA] === true) return false;
  // Un workspace con el agente de la bandeja (aunque este teléfono esté fuera de su lista) sigue como antes.
  const bot = m?.bot_conversacional as Record<string, unknown> | null | undefined;
  if (bot && typeof bot === 'object' && (bot.agente === true || bot.dominio === 'bandeja')) return false;
  return dominioDelAgente(bot, message.phone, { porDefecto: true }) !== 'bandeja';
}
