import 'server-only'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { declaraNiveles } from './niveles-solicitud'

/**
 * La solicitud de viaje sin formulario, del lado del servidor de la web:
 *   · `lineaSolicitudTexto`: ¿este workspace tiene la caja? Solo con el módulo del bot
 *     (`bandeja_solicitudes_wa`) y una línea de solicitud de viaje: la de la bandeja
 *     (`config_extra.bandeja_solicitudes.linea_id` o `linea_activa_id`, la misma que usa el bot)
 *     cuya primera etapa tiene un bloque `datos` que declara mínimo y deseable. Cualquier otro
 *     workspace o línea queda exactamente igual;
 *   · `llamarSolicitudTexto`: la llamada a la función `solicitud-texto` con la sesión de quien
 *     está en pantalla. Es la primera llamada de la web a una función edge.
 */

type Fila = Record<string, unknown>

export interface LineaSolicitudTexto {
  lineaId: string
}

export async function lineaSolicitudTexto(workspaceId: string): Promise<LineaSolicitudTexto | null> {
  const svc = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ws } = await (svc.from('workspaces') as any)
    .select('modules, config_extra, linea_activa_id')
    .eq('id', workspaceId)
    .maybeSingle()
  if (!ws || (ws.modules as Fila | null)?.bandeja_solicitudes_wa !== true) return null
  const cfg = ((ws.config_extra as Fila | null)?.bandeja_solicitudes ?? {}) as Fila
  const lineaId = (typeof cfg.linea_id === 'string' && cfg.linea_id) || (ws.linea_activa_id as string | null)
  if (!lineaId) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: etapa } = await (svc.from('etapas_negocio') as any)
    .select('id').eq('linea_id', lineaId).order('orden', { ascending: true }).limit(1).maybeSingle()
  if (!etapa) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bcs } = await (svc.from('bloque_configs') as any)
    .select('config_extra, bloque_definitions(tipo)')
    .eq('etapa_id', etapa.id).eq('workspace_id', workspaceId)
  const conNiveles = ((bcs ?? []) as Fila[]).some(b => {
    const tipo = ((b.bloque_definitions as Fila | null)?.tipo as string | undefined) ?? null
    const fields = ((b.config_extra as Fila | null)?.fields ?? null) as Array<{ nivel?: unknown }> | null
    return tipo === 'datos' && declaraNiveles(fields)
  })
  return conNiveles ? { lineaId } : null
}

/**
 * POST a la función con el JWT del usuario. El workspace no viaja: la función lo saca del perfil
 * (la misma fila que manda en el RLS). Devuelve el JSON de la función o un error legible.
 */
export async function llamarSolicitudTexto<T>(cuerpo: Record<string, unknown>): Promise<T | { ok: false; error: string; mensaje: string }> {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { ok: false, error: 'no_autenticado', mensaje: 'Tu sesión venció. Vuelve a entrar.' }
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/solicitud-texto`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      },
      body: JSON.stringify(cuerpo),
      cache: 'no-store',
    })
    const json = (await res.json().catch(() => null)) as T | null
    if (!json) return { ok: false, error: `http_${res.status}`, mensaje: 'No pude leerlo ahora. Tu texto sigue aquí: inténtalo otra vez.' }
    return json
  } catch {
    return { ok: false, error: 'red', mensaje: 'No pude leerlo ahora. Tu texto sigue aquí: inténtalo otra vez.' }
  }
}
