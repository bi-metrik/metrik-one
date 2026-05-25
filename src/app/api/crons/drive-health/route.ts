import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAccessToken } from '@/lib/google-drive'

// Cron de health check diario sobre Drive de cada workspace.
//
// Itera workspaces.drive_folder_id IS NOT NULL, refresca token (per-workspace
// si tiene la triple en config_extra, sino global), hace drive.files.get del
// folder padre. Registra en drive_health_log y, si falla, escribe en
// activity_log del workspace para visibilidad operacional.
//
// Schedule: diario 13:00 UTC (vercel.json)
//
// Detecta:
//  - Refresh token revocado (invalid_grant)
//  - Folder borrado / movido / sin acceso (404)
//  - Credenciales incompletas en config_extra

export const maxDuration = 60

type WorkspaceRow = {
  id: string
  slug: string
  drive_folder_id: string | null
  config_extra: Record<string, unknown> | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkWorkspace(
  supabase: any,
  ws: WorkspaceRow,
): Promise<{ ok: boolean; oauth_mode: string; folder_accessible: boolean }> {
  const started = Date.now()
  const cfg = (ws.config_extra ?? {}) as Record<string, unknown>
  const hasPerWs =
    !!(cfg.drive_refresh_token && cfg.drive_client_id && cfg.drive_client_secret)
  const oauth_mode = hasPerWs ? 'per_workspace' : 'global'

  let token_refresh_ok = false
  let folder_accessible = false
  let folder_name: string | null = null
  let shared_drive_id: string | null = null
  let error_code: string | null = null
  let error_message: string | null = null

  let token: string | null = null
  try {
    token = await getAccessToken(ws.id)
    token_refresh_ok = true
  } catch (e) {
    error_code = 'token_refresh_failed'
    error_message = e instanceof Error ? e.message : String(e)
  }

  if (token && ws.drive_folder_id) {
    try {
      const params = new URLSearchParams({
        supportsAllDrives: 'true',
        fields: 'id,name,trashed,driveId',
      })
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${ws.drive_folder_id}?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (res.ok) {
        const f = (await res.json()) as { name: string; trashed: boolean; driveId?: string }
        if (f.trashed) {
          error_code = 'folder_trashed'
          error_message = `Folder "${f.name}" esta en papelera`
        } else {
          folder_accessible = true
          folder_name = f.name
          shared_drive_id = f.driveId ?? null
        }
      } else {
        const body = await res.text()
        error_code = `folder_get_${res.status}`
        error_message = body.slice(0, 500)
      }
    } catch (e) {
      error_code = 'folder_check_exception'
      error_message = e instanceof Error ? e.message : String(e)
    }
  } else if (!ws.drive_folder_id) {
    error_code = 'no_drive_folder_id'
    error_message = 'workspaces.drive_folder_id es NULL'
  }

  const latency_ms = Date.now() - started

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('drive_health_log').insert({
    workspace_id: ws.id,
    oauth_mode,
    drive_folder_id: ws.drive_folder_id,
    folder_accessible,
    folder_name,
    shared_drive_id,
    token_refresh_ok,
    error_code,
    error_message,
    latency_ms,
  })

  const ok = token_refresh_ok && folder_accessible
  if (!ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('activity_log').insert({
      workspace_id: ws.id,
      entidad_tipo: 'workspace',
      entidad_id: ws.id,
      tipo: 'drive_health_failed',
      contenido: `Drive health check fallo (${oauth_mode}): ${error_code} — ${error_message?.slice(0, 200) ?? ''}`,
    })
  }

  return { ok, oauth_mode, folder_accessible }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronHeader = req.headers.get('x-vercel-cron')
  if (!cronHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await supabase
    .from('workspaces')
    .select('id, slug, drive_folder_id, config_extra')
    .not('drive_folder_id', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const workspaces = (data ?? []) as WorkspaceRow[]
  const results: Array<{ slug: string; ok: boolean; oauth_mode: string }> = []
  for (const ws of workspaces) {
    const r = await checkWorkspace(supabase, ws)
    results.push({ slug: ws.slug, ok: r.ok, oauth_mode: r.oauth_mode })
  }

  const ok = results.filter(r => r.ok).length
  const failed = results.length - ok
  return NextResponse.json({ checked: results.length, ok, failed, results })
}
