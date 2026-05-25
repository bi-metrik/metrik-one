/**
 * Pre-flight check de un workspace antes de marcarlo productivo.
 *
 * Valida que el setup de Drive sea funcional end-to-end (sin escribir nada
 * en DB, solo lectura + test crear/borrar carpeta de prueba). Reporta verde
 * o rojo por cada check. Exit code != 0 si algun check critico falla.
 *
 * Pensado para correrse:
 *  - Despues de setup-drive-workspace.ts (auto-recomendado al final)
 *  - Cada vez que Hana onboardea un nuevo cliente
 *  - Periodicamente como parte de mantenimiento (complementa cron health check)
 *
 * Uso:
 *   npx tsx scripts/preflight-workspace.ts <slug>
 *
 * Requiere en .env.local:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - GOOGLE_DRIVE_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN (para fallback global)
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const slug = process.argv[2]
if (!slug) {
  console.error('Uso: npx tsx scripts/preflight-workspace.ts <slug>')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

const checks: Array<{ name: string; ok: boolean; detail: string }> = []
function record(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} ${name} — ${detail}`)
}

async function refreshToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { access_token: string }
    return data.access_token
  } catch {
    return null
  }
}

async function main() {
  console.log(`\nPre-flight workspace "${slug}"\n`)

  const { data: wsRaw, error: errWs } = await sb
    .from('workspaces')
    .select('id, slug, name, config_extra, drive_folder_id')
    .eq('slug', slug)
    .single()
  if (errWs || !wsRaw) {
    console.error(`✗ Workspace "${slug}" no encontrado`)
    process.exit(1)
  }
  const ws = wsRaw as {
    id: string
    slug: string
    name: string
    config_extra: Record<string, unknown> | null
    drive_folder_id: string | null
  }

  console.log(`Workspace: ${ws.name} (${ws.id})\n`)
  console.log('=== Drive ===')

  // Modelo Shared Drive (caso AFI): no requiere workspaces.drive_folder_id —
  // las carpetas se crean directo en la Shared Drive via OAuth per-workspace.
  const sharedDriveId = (ws.config_extra ?? {})['drive_shared_drive_id'] as string | undefined

  // Check 1: drive_folder_id presente (skip si hay Shared Drive declarada)
  if (sharedDriveId) {
    console.log(`  ℹ Modelo Shared Drive — workspaces.drive_folder_id no requerido (shared_drive=${sharedDriveId})`)
  } else {
    record(
      'drive_folder_id seteado',
      !!ws.drive_folder_id,
      ws.drive_folder_id ?? '(NULL)',
    )
  }

  // Check 2: credenciales OAuth
  const cfg = (ws.config_extra ?? {}) as Record<string, unknown>
  const perWs = {
    refreshToken: cfg.drive_refresh_token as string | undefined,
    clientId: cfg.drive_client_id as string | undefined,
    clientSecret: cfg.drive_client_secret as string | undefined,
  }
  const hasPerWs = !!(perWs.refreshToken && perWs.clientId && perWs.clientSecret)
  const hasGlobal = !!(
    process.env.GOOGLE_DRIVE_CLIENT_ID &&
    process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN
  )

  let mode: 'per_workspace' | 'global' | 'none' = 'none'
  if (hasPerWs) mode = 'per_workspace'
  else if (hasGlobal) mode = 'global'

  record(
    'OAuth credenciales presentes',
    mode !== 'none',
    mode === 'per_workspace'
      ? 'per-workspace (config_extra.drive_*)'
      : mode === 'global'
      ? 'global (env vars)'
      : 'NINGUNA — Drive no funcionara',
  )

  // Check 3: triple completa si tiene parcial
  if (cfg.drive_refresh_token || cfg.drive_client_id || cfg.drive_client_secret) {
    record(
      'Triple drive_* completa en config_extra',
      hasPerWs,
      hasPerWs
        ? 'triple completa'
        : `INCOMPLETA — falta(n): ${[
            !perWs.refreshToken && 'drive_refresh_token',
            !perWs.clientId && 'drive_client_id',
            !perWs.clientSecret && 'drive_client_secret',
          ]
            .filter(Boolean)
            .join(', ')}`,
    )
  }

  // Check 4: refresh token valido
  let accessToken: string | null = null
  if (mode === 'per_workspace') {
    accessToken = await refreshToken(perWs.clientId!, perWs.clientSecret!, perWs.refreshToken!)
  } else if (mode === 'global') {
    accessToken = await refreshToken(
      process.env.GOOGLE_DRIVE_CLIENT_ID!,
      process.env.GOOGLE_DRIVE_CLIENT_SECRET!,
      process.env.GOOGLE_DRIVE_REFRESH_TOKEN!,
    )
  }
  record(
    'Refresh token valido',
    accessToken !== null,
    accessToken ? 'access token obtenido' : 'invalid_grant o error de red',
  )

  // Check 5: folder accesible
  // Si el modelo es Shared Drive y no hay drive_folder_id explicito, validamos
  // el Shared Drive root via files.list scoped a ese drive.
  const folderToCheck = ws.drive_folder_id ?? sharedDriveId ?? null

  if (accessToken && folderToCheck) {
    const params = new URLSearchParams({
      supportsAllDrives: 'true',
      fields: 'id,name,trashed,driveId,mimeType',
    })
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${folderToCheck}?${params.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      if (res.ok) {
        const f = (await res.json()) as {
          name: string
          trashed: boolean
          driveId?: string
          mimeType: string
        }
        record(
          'Folder padre accesible',
          !f.trashed && f.mimeType === 'application/vnd.google-apps.folder',
          f.trashed
            ? 'EN PAPELERA'
            : f.mimeType !== 'application/vnd.google-apps.folder'
            ? `mimeType invalido: ${f.mimeType}`
            : `"${f.name}" ${f.driveId ? `(Shared Drive ${f.driveId})` : '(My Drive)'}`,
        )

        // Check 6: test crear+borrar
        const testName = `__metrik_preflight_${Date.now()}`
        const createRes = await fetch(
          'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: testName,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [folderToCheck],
            }),
          },
        )
        if (createRes.ok) {
          const created = (await createRes.json()) as { id: string }
          const delRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${created.id}?supportsAllDrives=true`,
            { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
          )
          record(
            'Crear + borrar carpeta de prueba',
            createRes.ok && (delRes.ok || delRes.status === 404),
            delRes.ok || delRes.status === 404
              ? 'OK'
              : `creo pero no borro (${delRes.status}) — huerfano ${created.id}`,
          )
        } else {
          record('Crear + borrar carpeta de prueba', false, `crear fallo: ${createRes.status}`)
        }
      } else {
        record('Folder padre accesible', false, `${res.status} — ${(await res.text()).slice(0, 100)}`)
      }
    } catch (e) {
      record('Folder padre accesible', false, e instanceof Error ? e.message : String(e))
    }
  }

  const failed = checks.filter(c => !c.ok)
  console.log(`\n=== Resumen ===`)
  console.log(`Checks: ${checks.length} — OK: ${checks.length - failed.length} — Fallidos: ${failed.length}`)
  if (failed.length > 0) {
    console.log(`\n✗ Workspace "${slug}" NO esta listo para produccion`)
    process.exit(1)
  }
  console.log(`\n✓ Workspace "${slug}" listo para produccion`)
}

main().catch(e => {
  console.error('\n✗ Error fatal:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
