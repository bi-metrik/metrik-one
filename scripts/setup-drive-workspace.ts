/**
 * Setup canónico de Google Drive OAuth per-workspace.
 *
 * Persiste la triple drive_refresh_token + drive_client_id + drive_client_secret
 * en workspaces.config_extra del workspace destino, y opcionalmente actualiza
 * workspaces.drive_folder_id. Valida acceso al folder ANTES de persistir.
 *
 * Único punto de entrada autorizado para configurar Drive per-workspace —
 * reemplaza updates SQL manuales que generaban borrados accidentales.
 *
 * Uso:
 *   npx tsx scripts/setup-drive-workspace.ts <slug> [drive_folder_id]
 *
 * Las credenciales se leen de env vars del proceso (no se piden interactivas
 * para que el script sea reproducible en CI/scripts encadenados):
 *   - WS_DRIVE_REFRESH_TOKEN     (obligatorio)
 *   - WS_DRIVE_CLIENT_ID         (obligatorio)
 *   - WS_DRIVE_CLIENT_SECRET     (obligatorio)
 *   - WS_DRIVE_FOLDER_ID         (opcional — si se pasa por arg toma precedencia)
 *   - WS_DRIVE_SHARED_DRIVE_ID   (opcional — informativo)
 *   - WS_DRIVE_GCP_PROJECT       (opcional — informativo)
 *
 * Requiere en .env.local del repo:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const slug = process.argv[2]
const folderArg = process.argv[3]

if (!slug) {
  console.error('Uso: npx tsx scripts/setup-drive-workspace.ts <slug> [drive_folder_id]')
  process.exit(1)
}

const refreshToken = process.env.WS_DRIVE_REFRESH_TOKEN
const clientId = process.env.WS_DRIVE_CLIENT_ID
const clientSecret = process.env.WS_DRIVE_CLIENT_SECRET
const sharedDriveId = process.env.WS_DRIVE_SHARED_DRIVE_ID
const gcpProject = process.env.WS_DRIVE_GCP_PROJECT
const folderId = folderArg ?? process.env.WS_DRIVE_FOLDER_ID

if (!refreshToken || !clientId || !clientSecret) {
  console.error('Faltan env vars: WS_DRIVE_REFRESH_TOKEN, WS_DRIVE_CLIENT_ID, WS_DRIVE_CLIENT_SECRET')
  process.exit(1)
}

if (!folderId) {
  console.error('Falta drive_folder_id (pasarlo como segundo arg o via WS_DRIVE_FOLDER_ID)')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

async function refreshAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: refreshToken!,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OAuth refresh fallo (${res.status}): ${body.slice(0, 300)}`)
  }
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

async function validateFolderAccess(accessToken: string): Promise<{ name: string; driveId: string | null }> {
  const params = new URLSearchParams({
    supportsAllDrives: 'true',
    fields: 'id,name,trashed,driveId,mimeType',
  })
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${folderId}?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`No se puede acceder al folder ${folderId} (${res.status}): ${body.slice(0, 300)}`)
  }
  const file = (await res.json()) as {
    id: string
    name: string
    trashed: boolean
    driveId?: string
    mimeType: string
  }
  if (file.trashed) throw new Error(`Folder ${folderId} esta en papelera`)
  if (file.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error(`${folderId} no es un folder (mimeType: ${file.mimeType})`)
  }
  return { name: file.name, driveId: file.driveId ?? null }
}

async function testCreateAndDelete(accessToken: string): Promise<void> {
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
        parents: [folderId],
      }),
    },
  )
  if (!createRes.ok) {
    const body = await createRes.text()
    throw new Error(`Test crear falló (${createRes.status}): ${body.slice(0, 300)}`)
  }
  const created = (await createRes.json()) as { id: string }
  const delRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${created.id}?supportsAllDrives=true`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!delRes.ok && delRes.status !== 404) {
    console.warn(`Test borrar falló (${delRes.status}) — folder ${created.id} quedó huérfano`)
  }
}

async function main() {
  console.log(`\n→ Buscando workspace "${slug}"...`)
  const { data: wsRaw, error: errWs } = await sb
    .from('workspaces')
    .select('id, slug, name, config_extra, drive_folder_id')
    .eq('slug', slug)
    .single()
  if (errWs || !wsRaw) {
    console.error(`Workspace "${slug}" no encontrado:`, errWs?.message)
    process.exit(1)
  }
  const ws = wsRaw as {
    id: string
    slug: string
    name: string
    config_extra: Record<string, unknown> | null
    drive_folder_id: string | null
  }
  console.log(`  ws.id = ${ws.id} (${ws.name})`)
  console.log(`  drive_folder_id actual: ${ws.drive_folder_id ?? '(null)'}`)

  console.log(`\n→ Validando OAuth (refresh token)...`)
  const accessToken = await refreshAccessToken()
  console.log(`  OK (access token obtenido)`)

  console.log(`\n→ Validando acceso al folder ${folderId}...`)
  const { name: folderName, driveId } = await validateFolderAccess(accessToken)
  console.log(`  OK — folder "${folderName}" ${driveId ? `(Shared Drive ${driveId})` : '(My Drive)'}`)

  console.log(`\n→ Test crear + borrar carpeta dentro del folder padre...`)
  await testCreateAndDelete(accessToken)
  console.log(`  OK (permisos write/delete validados)`)

  const currentConfig = ws.config_extra ?? {}
  const newConfig: Record<string, unknown> = {
    ...currentConfig,
    drive_refresh_token: refreshToken,
    drive_client_id: clientId,
    drive_client_secret: clientSecret,
  }
  if (sharedDriveId) newConfig.drive_shared_drive_id = sharedDriveId
  if (gcpProject) newConfig.drive_gcp_project = gcpProject

  const preservedKeys = Object.keys(currentConfig).filter(
    k => !['drive_refresh_token', 'drive_client_id', 'drive_client_secret', 'drive_shared_drive_id', 'drive_gcp_project'].includes(k),
  )
  if (preservedKeys.length > 0) {
    console.log(`\n→ Preservando keys existentes en config_extra: ${preservedKeys.join(', ')}`)
  }

  console.log(`\n→ Persistiendo config_extra.drive_* + drive_folder_id...`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (sb as any)
    .from('workspaces')
    .update({ config_extra: newConfig, drive_folder_id: folderId })
    .eq('id', ws.id)
  if (errUpd) {
    console.error(`Fallo update:`, errUpd.message)
    process.exit(1)
  }

  console.log(`\n✓ OK — workspace "${slug}" configurado con Drive OAuth per-workspace`)
  console.log(`  drive_folder_id: ${folderId}`)
  console.log(`  config_extra.drive_*: triple completa persistida`)
  console.log(`\nSiguientes pasos:`)
  console.log(`  1. Anotar refresh_token en .credentials.md (responsabilidad Kaori)`)
  console.log(`  2. Correr preflight: npx tsx scripts/preflight-workspace.ts ${slug}`)
  console.log(`  3. Crear un negocio de prueba y verificar carpeta_url en DB`)
}

main().catch(e => {
  console.error('\n✗ ERROR:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
