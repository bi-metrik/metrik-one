// ============================================================
// Bot Session Management (bot_sessions table)
// ============================================================

import type { BotSession, LastContext, SessionContext, SessionState, SupabaseClient } from './types.ts';

const SESSION_TTL_MINUTES = 15;
const LAST_CONTEXT_TTL_MINUTES = 5; // conversational memory window

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

  // Load conversational memory from the most recent completed session (within TTL)
  const lastContext = await getRecentLastContext(supabase, phone, workspaceId);

  // Create new session
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60 * 1000).toISOString();
  const initialContext: SessionContext = lastContext ? { last_context: lastContext } : {};
  const { data: created, error } = await supabase
    .from('bot_sessions')
    .insert({
      workspace_id: workspaceId,
      user_phone: phone,
      state: 'started',
      context: initialContext,
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

/**
 * Fetch the most recent LastContext for this phone from the latest session
 * (completed or expired) within the TTL window. Returns null if none or stale.
 */
export async function getRecentLastContext(
  supabase: SupabaseClient,
  phone: string,
  workspaceId: string,
): Promise<LastContext | null> {
  const cutoff = new Date(Date.now() - LAST_CONTEXT_TTL_MINUTES * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('bot_sessions')
    .select('context, started_at')
    .eq('user_phone', phone)
    .eq('workspace_id', workspaceId)
    .gt('started_at', cutoff)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const lc = data?.context?.last_context as LastContext | undefined;
  if (!lc || !lc.created_at) return null;
  // Double-check TTL against the context's own timestamp
  if (new Date(lc.created_at).getTime() < Date.now() - LAST_CONTEXT_TTL_MINUTES * 60 * 1000) {
    return null;
  }
  return lc;
}

/** Save last_context on the current session (merged into context JSONB) */
export async function saveLastContext(
  supabase: SupabaseClient,
  sessionId: string,
  lastContext: Omit<LastContext, 'created_at'>,
): Promise<void> {
  const full: LastContext = { ...lastContext, created_at: new Date().toISOString() };
  // Merge into existing context
  const { data: current } = await supabase
    .from('bot_sessions')
    .select('context')
    .eq('id', sessionId)
    .single();
  const merged = { ...(current?.context || {}), last_context: full };
  await supabase.from('bot_sessions').update({ context: merged }).eq('id', sessionId);
}
