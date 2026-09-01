// ============================================================
// wa_envios — registrar que salio y que fue de ello
// ------------------------------------------------------------
// Todo lo que MeTRIK le manda a alguien por WhatsApp deja fila aqui, y los acuses que
// Meta devuelve por el webhook la actualizan. Ver la migracion 20260901000003 para el
// porque de la tabla aparte (resumen: `wa_message_log.direction='outbound'` es el
// contador de alertas, no una bitacora, y escribir ahi apaga las alertas en silencio).
//
// Regla dura de este modulo: NADA de lo que hace puede tumbar un envio. Registrar es
// telemetria; si la base no responde, el mensaje igual tiene que salir. Por eso cada
// funcion atrapa su propio error y solo lo escribe en consola.
// ============================================================

import { getServiceClient } from './supabase-client.ts';
import type { SupabaseClient } from './types.ts';

export type OrigenEnvio = 'bot' | 'alerta' | 'template' | 'interno';

// Un cliente por isolate. `registrarEnvio` corre en CADA mensaje que sale, y una corrida
// de wa-alerts son cientos: construir uno nuevo por envio es basura pura.
let cliente: SupabaseClient | null = null;
function clienteDeEnvios(): SupabaseClient {
  if (!cliente) cliente = getServiceClient();
  return cliente;
}

/** Lo que el que envia sabe y la tabla no puede adivinar. Todo opcional a proposito. */
export interface EnvioCtx {
  origen?: OrigenEnvio;
  workspaceId?: string;
  intent?: string;
  templateName?: string;
}

/** Acuse de Meta ya normalizado. `phone` viene de `recipient_id`. */
export interface StatusEntrega {
  waMessageId: string;
  status: string;
  statusAt?: string;
  phone?: string;
  errorCode?: number;
  errorTitle?: string;
}

/**
 * Deja constancia de un mensaje saliente.
 * `waMessageId` nulo significa que la Graph API lo rechazo: la fila igual se escribe,
 * porque un envio que nunca existio es exactamente lo que hoy no se ve.
 */
export async function registrarEnvio(
  phone: string,
  waMessageId: string | null,
  preview: string,
  ctx: EnvioCtx = {},
): Promise<void> {
  try {
    await clienteDeEnvios().from('wa_envios').insert({
      wa_message_id: waMessageId,
      phone,
      workspace_id: ctx.workspaceId ?? null,
      origen: ctx.origen ?? 'bot',
      template_name: ctx.templateName ?? null,
      intent: ctx.intent ?? null,
      preview: preview.slice(0, 300),
      status: waMessageId ? 'aceptado' : 'rechazado',
      status_at: waMessageId ? null : new Date().toISOString(),
    });
  } catch (err) {
    console.error('[wa-envios] no se pudo registrar el envio:', err);
  }
}

/** Aplica los acuses de Meta. El orden lo resuelve la base (`wa_aplicar_status`). */
export async function aplicarStatuses(
  supabase: SupabaseClient,
  statuses: StatusEntrega[],
): Promise<void> {
  for (const s of statuses) {
    try {
      const { error } = await supabase.rpc('wa_aplicar_status', {
        p_wa_message_id: s.waMessageId,
        p_status: s.status,
        p_status_at: s.statusAt ?? new Date().toISOString(),
        p_phone: s.phone ?? null,
        p_error_code: s.errorCode ?? null,
        p_error_title: s.errorTitle ?? null,
      });
      if (error) console.error(`[wa-envios] status ${s.status} no aplico:`, error.message);
      if (s.status === 'failed') {
        console.error(`[wa-envios] ENTREGA FALLIDA a ${s.phone}: ${s.errorCode} ${s.errorTitle}`);
      }
    } catch (err) {
      console.error('[wa-envios] error aplicando status:', err);
    }
  }
}

/**
 * Un texto corto que describa el mensaje, sea del tipo que sea. Sirve para que la fila
 * se pueda leer sin ir a buscar el payload a los logs de Meta.
 */
export function resumenPayload(payload: Record<string, unknown>): string {
  const tipo = String(payload.type ?? 'desconocido');
  if (tipo === 'text') {
    const t = payload.text as { body?: string } | undefined;
    return t?.body ?? '';
  }
  if (tipo === 'template') {
    const t = payload.template as { name?: string } | undefined;
    return `[plantilla ${t?.name ?? '?'}]`;
  }
  if (tipo === 'interactive') {
    const i = payload.interactive as { type?: string; body?: { text?: string } } | undefined;
    return `[${i?.type ?? 'interactive'}] ${i?.body?.text ?? ''}`.trim();
  }
  if (tipo === 'contacts') return '[tarjeta de contacto]';
  return `[${tipo}]`;
}
