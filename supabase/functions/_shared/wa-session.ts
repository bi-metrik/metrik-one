// ============================================================
// Bot Session Management (bot_sessions table)
// ============================================================

import type { BotSession, SessionContext, SessionState, SupabaseClient } from './types.ts';

const SESSION_TTL_MINUTES = 15;

/** Get active session or create new one */
export async function getOrCreateSession(
  supabase: SupabaseClient,
  phone: string,
  workspaceId: string,
): Promise<BotSession> {
  // Look for active (non-expired) session
  const { data: existing } = await supabase
    .from('bot_sessions')
    .select('*')
    .eq('user_phone', phone)
    .eq('workspace_id', workspaceId)
    .neq('state', 'completed')
    .neq('state', 'expired')
    .gt('expires_at', new Date().toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (existing) return existing as BotSession;

  // Create new session
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();
  const { data: created, error } = await supabase
    .from('bot_sessions')
    .insert({
      workspace_id: workspaceId,
      user_phone: phone,
      state: 'started',
      context: {},
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (error) {
    console.error('[wa-session] Create error:', error);
    throw new Error('Failed to create bot session');
  }

  return created as BotSession;
}

/** Update session state and context */
export async function updateSession(
  supabase: SupabaseClient,
  sessionId: string,
  state: SessionState,
  contextUpdate?: Partial<SessionContext>,
): Promise<void> {
  const updates: Record<string, unknown> = { state };

  if (contextUpdate) {
    // Merge context — fetch current first
    const { data: current } = await supabase
      .from('bot_sessions')
      .select('context')
      .eq('id', sessionId)
      .single();

    updates.context = { ...(current?.context || {}), ...contextUpdate };
  }

  // Extend expiry on activity
  updates.expires_at = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('bot_sessions')
    .update(updates)
    .eq('id', sessionId);

  if (error) console.error('[wa-session] Update error:', error);
}

/** Mark session as completed */
export async function completeSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<void> {
  await updateSession(supabase, sessionId, 'completed');
}

/** Check if session is in a multi-step flow (awaiting user response) */
export function isAwaitingResponse(session: BotSession): boolean {
  return ['confirming', 'awaiting_selection', 'awaiting_reason', 'awaiting_payment_status', 'awaiting_image', 'collecting', 'awaiting_timeout_confirm'].includes(session.state);
}
