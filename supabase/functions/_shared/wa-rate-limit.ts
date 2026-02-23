// ============================================================
// Rate Limiting (D97: 30 msg/hr inbound, 2 alerts/day outbound)
// ============================================================

import type { SupabaseClient } from './types.ts';

const INBOUND_LIMIT = 30;  // per user per hour
const OUTBOUND_ALERT_LIMIT = 2; // per user per day

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

/** Check if outbound alert is within daily limit. Returns true if allowed. */
export async function checkOutboundAlertLimit(
  supabase: SupabaseClient,
  phone: string,
): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('wa_message_log')
    .select('*', { count: 'exact', head: true })
    .eq('phone', phone)
    .eq('direction', 'outbound')
    .gte('created_at', startOfDay.toISOString());

  return (count ?? 0) < OUTBOUND_ALERT_LIMIT;
}

/** Log a message for rate limiting and debugging */
export async function logMessage(
  supabase: SupabaseClient,
  phone: string,
  direction: 'inbound' | 'outbound',
  workspaceId?: string,
  intent?: string,
  messagePreview?: string,
): Promise<void> {
  await supabase.from('wa_message_log').insert({
    workspace_id: workspaceId,
    phone,
    direction,
    intent,
    message_preview: messagePreview?.slice(0, 100),
  });
}
