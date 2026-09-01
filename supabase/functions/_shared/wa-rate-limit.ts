// ============================================================
// Rate Limiting (D97: 30 msg/hr inbound)
// El tope de alertas salientes vive en `wa-alerta.ts` — ver la nota de abajo.
// ============================================================

import type { SupabaseClient } from './types.ts';

const INBOUND_LIMIT = 30;  // per user per hour

/** Check if inbound message is within rate limit. Returns true if allowed. */
export async function checkInboundLimit(supabase: SupabaseClient, phone: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count } = await supabase
    .from('wa_message_log')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'inbound')
    .gte('created_at', oneHourAgo);

  return (count ?? 0) < INBOUND_LIMIT;
}

// ⚠️ `checkOutboundAlertLimit` vivia aqui y contaba `wa_message_log.direction='outbound'`.
// Se movio a `wa-alerta.ts` como `hayCupoDeAlerta` y ahora cuenta `wa_envios`, que si sabe
// como termino cada mensaje. El motivo esta escrito alla; el resumen es que las tres W25
// del 2026-09-01 las rechazo Meta con 131047, nadie las recibio, y consumieron cupo igual.
//
// No dejar aqui un contador contra `wa_message_log`: esa tabla ya no la escribe nadie en
// direccion 'outbound', asi que un tope construido sobre ella no frena nada nunca.

export interface LogTelemetry {
  parser_source?: 'fast_path' | 'gemini' | 'regex';
  gemini_model?: string;
  gemini_input_tokens?: number;
  gemini_output_tokens?: number;
  gemini_latency_ms?: number;
  confidence?: number;
}

/** Log a message for rate limiting and debugging */
export async function logMessage(
  supabase: SupabaseClient,
  phone: string,
  direction: 'inbound' | 'outbound',
  workspaceId?: string,
  intent?: string,
  messagePreview?: string,
  telemetry?: LogTelemetry,
): Promise<void> {
  await supabase.from('wa_message_log').insert({
    workspace_id: workspaceId,
    phone,
    direction,
    intent,
    message_preview: messagePreview?.slice(0, 100),
    parser_source: telemetry?.parser_source,
    gemini_model: telemetry?.gemini_model,
    gemini_input_tokens: telemetry?.gemini_input_tokens,
    gemini_output_tokens: telemetry?.gemini_output_tokens,
    gemini_latency_ms: telemetry?.gemini_latency_ms,
    confidence: telemetry?.confidence,
  });
}
