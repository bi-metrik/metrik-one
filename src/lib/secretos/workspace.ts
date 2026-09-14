import { createServiceClient } from '@/lib/supabase/server'

// SOLO SERVIDOR (usa service role). Sin `import 'server-only'` a proposito: los scripts
// de `scripts/` importan `google-drive.ts` con tsx, y ese marcador lanza fuera de Next.
//
// Credenciales por workspace: viven en Supabase Vault como `ws:<workspace_id>:<clave>`
// (migracion 20260915010000_secretos_workspace_vault.sql).
//
// NO van en `workspaces.config_extra`. Esa columna la lee y la actualiza cualquier
// miembro del workspace por REST: RLS no mira rol. Frente del 2026-09-14.
//
// Transicion: mientras las claves no se trasladen, siguen en `config_extra`. Por eso
// cada lectura prefiere Vault y cae a `config_extra`. Cuando el traslado corra, el
// respaldo queda sin datos y se borra en un PR aparte.

export const CLAVES_SECRETAS = [
  'drive_refresh_token',
  'drive_client_id',
  'drive_client_secret',
  'siigo_username',
  'siigo_access_key',
  'siigo_partner_id',
  'valida_api_key',
  'funnelchat_webhook_token',
] as const

export type ClaveSecreta = (typeof CLAVES_SECRETAS)[number]
export type SecretosWorkspace = Partial<Record<ClaveSecreta, string>>

type ErrorRpc = { code?: string; message: string } | null
type ClienteRpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: ErrorRpc }>
}

// PostgREST responde PGRST202 cuando la funcion no existe: la migracion aun no se
// aplico. Es el unico error que se tolera. Cualquier otro se lanza, porque tragarlo
// haria que un fallo de base pareciera "credencial no configurada".
const FUNCION_INEXISTENTE = 'PGRST202'

function esTextoNoVacio(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/** Todas las credenciales del workspace que hay en Vault. `{}` si no hay ninguna. */
export async function leerSecretosWorkspace(
  workspaceId: string,
  cliente: ClienteRpc = createServiceClient() as unknown as ClienteRpc,
): Promise<SecretosWorkspace> {
  const { data, error } = await cliente.rpc('leer_secretos_workspace', { p_workspace_id: workspaceId })
  if (error) {
    if (error.code === FUNCION_INEXISTENTE) return {}
    throw new Error(`No se pudieron leer las credenciales del workspace ${workspaceId}: ${error.message}`)
  }
  const crudo = (data ?? {}) as Record<string, unknown>
  const secretos: SecretosWorkspace = {}
  for (const clave of CLAVES_SECRETAS) {
    if (esTextoNoVacio(crudo[clave])) secretos[clave] = crudo[clave]
  }
  return secretos
}

/** Ruta de la clave dentro de `config_extra` mientras dure la transicion. */
const RUTA_EN_CONFIG_EXTRA: Record<ClaveSecreta, readonly string[]> = {
  drive_refresh_token: ['drive_refresh_token'],
  drive_client_id: ['drive_client_id'],
  drive_client_secret: ['drive_client_secret'],
  siigo_username: ['siigo_username'],
  siigo_access_key: ['siigo_access_key'],
  siigo_partner_id: ['siigo_partner_id'],
  valida_api_key: ['valida_api_key'],
  funnelchat_webhook_token: ['funnelchat', 'webhook_token'],
}

/** Vault primero; si no esta, lo que quede en `config_extra`. */
export function secretoConRespaldo(
  vault: SecretosWorkspace,
  configExtra: Record<string, unknown> | null | undefined,
  clave: ClaveSecreta,
): string | undefined {
  if (esTextoNoVacio(vault[clave])) return vault[clave]
  let nodo: unknown = configExtra ?? {}
  for (const paso of RUTA_EN_CONFIG_EXTRA[clave]) {
    if (!nodo || typeof nodo !== 'object') return undefined
    nodo = (nodo as Record<string, unknown>)[paso]
  }
  return esTextoNoVacio(nodo) ? nodo : undefined
}

/**
 * Workspace dueño de una credencial, segun Vault. `null` si nadie la tiene, si la
 * tienen dos, o si la migracion aun no se aplico.
 */
export async function workspacePorSecreto(
  clave: ClaveSecreta,
  valor: string,
  cliente: ClienteRpc = createServiceClient() as unknown as ClienteRpc,
): Promise<string | null> {
  const { data, error } = await cliente.rpc('workspace_por_secreto', { p_clave: clave, p_valor: valor })
  if (error) {
    if (error.code === FUNCION_INEXISTENTE) return null
    throw new Error(`No se pudo resolver la credencial ${clave}: ${error.message}`)
  }
  return esTextoNoVacio(data) ? data : null
}
