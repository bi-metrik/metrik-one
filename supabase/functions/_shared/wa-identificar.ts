// ============================================================
// Identificación del remitente del bot de WhatsApp del equipo
// ============================================================
//
// Primero el staff (RPC `wa_identify_user`), después los colaboradores de `wa_collaborators`.
//
// El bug (2026-10-01): la consulta de colaboradores pedía una columna `role` que la tabla NO
// tiene. PostgREST respondía 42703, el código ignoraba `error` y el primer colaborador real
// (trappvel) caía como «número desconocido». Por eso:
//   - las columnas se piden de una lista fija (`COLUMNAS_COLABORADOR`) que la prueba compara
//     contra las columnas reales de la tabla;
//   - un colaborador entra siempre como `operator` (la tabla no guarda rol);
//   - todo error de lectura se registra en el log en vez de tragarse.

import type { SupabaseClient, UserRole, WaUser } from './types.ts';

/** Columnas que se leen de `wa_collaborators`. Todas deben existir en la tabla. */
export const COLUMNAS_COLABORADOR = ['id', 'workspace_id', 'name', 'phone'] as const;

/** Rol con el que entra un colaborador: `wa_collaborators` no tiene columna de rol. */
export const ROL_COLABORADOR: UserRole = 'operator';

const ROLES_VALIDOS: UserRole[] = ['owner', 'admin', 'operator', 'supervisor', 'contador', 'read_only'];

export async function identificarRemitente(
  supabase: SupabaseClient,
  phone: string,
): Promise<WaUser | null> {
  // Normalize phone (remove +, spaces, etc.)
  const normalized = phone.replace(/[\s+\-()]/g, '');

  // 1. Staff del workspace (via RPC — strips non-digits for matching)
  const { data: staffRows, error: staffError } = await supabase.rpc('wa_identify_user', { p_phone: normalized });
  if (staffError) {
    console.error(`[wa-identificar] wa_identify_user fallo: ${staffError.code ?? ''} ${staffError.message ?? ''}`);
  }
  const staffMatch = staffRows?.[0];

  if (staffMatch) {
    const modulos = await leerWorkspace(supabase, staffMatch.workspace_id);

    let role: UserRole = 'operator';
    if (staffMatch.es_principal) {
      role = 'owner';
    } else if (staffMatch.role) {
      role = ROLES_VALIDOS.includes(staffMatch.role) ? staffMatch.role : 'operator';
    }

    return {
      workspace_id: staffMatch.workspace_id,
      phone: normalized,
      name: staffMatch.full_name,
      role,
      user_id: staffMatch.user_id || undefined,
      subscription_status: modulos?.subscription_status || 'trial',
      modulos: modulos ?? null,
    };
  }

  // 2. Colaborador de WhatsApp (con o sin «+» guardado)
  const { data: collabMatch, error: collabError } = await supabase
    .from('wa_collaborators')
    .select(COLUMNAS_COLABORADOR.join(', '))
    .or(`phone.eq.${normalized},phone.eq.+${normalized}`)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (collabError) {
    console.error(`[wa-identificar] wa_collaborators fallo: ${collabError.code ?? ''} ${collabError.message ?? ''}`);
  }

  if (collabMatch) {
    const modulos = await leerWorkspace(supabase, collabMatch.workspace_id);
    return {
      workspace_id: collabMatch.workspace_id,
      phone: normalized,
      name: collabMatch.name,
      role: ROL_COLABORADOR,
      collaborator_id: collabMatch.id,
      subscription_status: modulos?.subscription_status || 'trial',
      modulos: modulos ?? null,
    };
  }

  return null;
}

/**
 * La fila del workspace del remitente. `bot_conversacional` es SOLO la llave
 * `config_extra.bot_conversacional` (el interruptor del intérprete, `wa-interprete-reglas.ts`): va en
 * esta misma lectura para que el interruptor apagado no cueste ni una consulta más. Ausente o nula
 * (workspaces que no la tienen) = apagado. Igual `aviso_datos_bot` (la puerta del aviso de datos,
 * `aviso-datos-bot.ts`): misma lectura, y ausente = apagada.
 */
async function leerWorkspace(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<{
  subscription_status?: string;
  modules?: Record<string, unknown> | null;
  bot_conversacional?: unknown;
  aviso_datos_bot?: unknown;
} | null> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('subscription_status, modules, bot_conversacional:config_extra->bot_conversacional, aviso_datos_bot:config_extra->aviso_datos_bot')
    .eq('id', workspaceId)
    .single();
  if (error) {
    console.error(`[wa-identificar] workspaces ${workspaceId} fallo: ${error.code ?? ''} ${error.message ?? ''}`);
  }
  return data ?? null;
}
