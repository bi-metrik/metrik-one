// ============================================================
// Resolución del proveedor de almacenamiento por workspace, con cache corta.
//
// ⚠️ Sin `import 'server-only'` A PROPÓSITO: lo importa `ensure-drive-folder.ts`, que
// a su vez importan scripts de cargue corridos con `tsx` fuera de Next, donde ese
// marcador no resuelve. La llave nunca sale de aquí hacia el navegador de todas
// formas: vive en una variable SIN prefijo `NEXT_PUBLIC_`, que Next no incrusta en el
// bundle del cliente.
// ============================================================

import { createServiceClient } from '@/lib/supabase/server'
import {
  ErrorAlmacenamiento,
  esAlmacenamientoExterno,
  leerConfigAlmacenamiento,
  type ConfigAlmacenamiento,
} from './config'

/** Misma escala que el resto de lecturas de config: un cambio tarda como mucho esto en verse. */
const TTL_MS = 60_000

type Entrada = { expira: number; slug: string | null; configExtra: Record<string, unknown> }
const cache = new Map<string, Entrada>()

async function leerWorkspace(workspaceId: string): Promise<Entrada> {
  const hit = cache.get(workspaceId)
  if (hit && hit.expira > Date.now()) return hit

  const svc = createServiceClient()
  // `config_extra` es server-only: se lee con el cliente de servicio y se acota por id.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (svc as any)
    .from('workspaces')
    .select('slug, config_extra')
    .eq('id', workspaceId)
    .maybeSingle()

  if (error) {
    throw new ErrorAlmacenamiento(`No se pudo leer la configuración de almacenamiento: ${error.message}`)
  }
  if (!data) {
    throw new ErrorAlmacenamiento(`Workspace ${workspaceId} no encontrado al resolver su almacenamiento`)
  }

  const entrada: Entrada = {
    expira: Date.now() + TTL_MS,
    slug: (data.slug as string | null) ?? null,
    configExtra: (data.config_extra ?? {}) as Record<string, unknown>,
  }
  cache.set(workspaceId, entrada)
  return entrada
}

/**
 * ¿El workspace guarda sus archivos fuera de Drive? Solo mira la marca: sirve para
 * decidir qué NO hacer (crear carpeta, empujar a Drive) aunque falte la llave.
 */
export async function usaAlmacenamientoExterno(workspaceId: string): Promise<boolean> {
  const ws = await leerWorkspace(workspaceId)
  return esAlmacenamientoExterno(ws.configExtra)
}

/** Configuración completa. Lanza `ErrorAlmacenamiento` si el workspace es externo y falta algo. */
export async function configAlmacenamiento(workspaceId: string): Promise<ConfigAlmacenamiento> {
  const ws = await leerWorkspace(workspaceId)
  return leerConfigAlmacenamiento({ slug: ws.slug, configExtra: ws.configExtra, env: process.env })
}

/** Solo para pruebas y scripts: olvida lo leído. */
export function limpiarCacheAlmacenamiento(): void {
  cache.clear()
}
