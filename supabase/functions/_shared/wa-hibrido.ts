// ============================================================
// El interruptor del bot híbrido de la bandeja, por workspace (2026-10-06)
// ============================================================
//
// `config_extra.bot_conversacional.hibrido = true` prende los puntos de decisión (`wa-decision.ts`): las preguntas que
// esperan una elección salen con botones o listas, el código lee solo lo exacto y lo demás lo lee el modelo con las
// opciones vigentes. Apagado (ausente, `false` o cualquier otra cosa), la bandeja se porta exactamente como antes: los
// lectores de texto libre de cada pregunta, sin listas ni modelo de decisión. Sin migración: es una llave del jsonb.
// ============================================================

import type { SupabaseClient } from './types.ts';

/** Lee `bot_conversacional.hibrido`: solo `true` literal lo prende. */
export function leerHibrido(botConversacional: unknown): boolean {
  const b = botConversacional as { hibrido?: unknown } | null | undefined;
  return !!b && typeof b === 'object' && b.hibrido === true;
}

/** El interruptor del workspace. Si no se puede leer, apagado (el bot de siempre). */
export async function hibridoDelWorkspace(supabase: SupabaseClient, workspaceId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle();
    if (error || !data) return false;
    return leerHibrido((data.config_extra as { bot_conversacional?: unknown } | null)?.bot_conversacional);
  } catch {
    return false;
  }
}
