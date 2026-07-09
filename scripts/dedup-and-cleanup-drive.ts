/**
 * Mantenimiento Drive de un workspace:
 *  (A) DEDUP: por cada negocio, en su carpeta canónica deja solo los archivos
 *      cuyo ID esté referenciado en negocio_bloques.data (drive_file_id, versiones,
 *      etc.). Los demás (re-subidas huérfanas) → papelera. NUNCA borra un archivo
 *      enlazado por un bloque → cero links rotos.
 *  (B) STRAY: carpetas en el root con formato de codigo de negocio ("X1 26 3")
 *      que NO corresponden a ningún negocio actual (negocios borrados) → papelera.
 *
 * Uso:
 *   DRY_RUN=true  npx tsx scripts/dedup-and-cleanup-drive.ts <workspace_id>
 *   DRY_RUN=false npx tsx scripts/dedup-and-cleanup-drive.ts <workspace_id>
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const WS_ID = process.argv[2]
const DRY_RUN = process.env.DRY_RUN !== 'false'
// Códigos de negocio a EXCLUIR del dedup (ej. radicados ante la DIAN: solo se suma
// el archivo nuevo, no se borra el viejo). Coma-separado en env SKIP_CODES.
const SKIP_CODES = new Set((process.env.SKIP_CODES ?? '').split(',').map(s => s.trim()).filter(Boolean))
// Si ONLY_CODES está seteado, el dedup por-negocio SOLO corre para esos (acota alcance).
const ONLY_CODES = new Set((process.env.ONLY_CODES ?? '').split(',').map(s => s.trim()).filter(Boolean))
const FOLDER = 'application/vnd.google-apps.folder'
const API = 'https://www.googleapis.com/drive/v3/files'
const CODIGO_RE = /^[A-Z]+\d* \d{2} \d+$/

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!WS_ID || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Uso: DRY_RUN=true npx tsx scripts/dedup-and-cleanup-drive.ts <workspace_id>')
  process.exit(1)
}
const supa = createClient(SUPABASE_URL, SUPABASE_KEY)

async function getToken(cid: string, csec: string, rtok: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cid, client_secret: csec, refresh_token: rtok, grant_type: 'refresh_token' }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error('OAuth refresh fallo: ' + JSON.stringify(j))
  return j.access_token as string
}

type DriveFile = { id: string; name: string; mimeType: string }
async function listChildren(parent: string, token: string): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const q = encodeURIComponent(`'${parent}' in parents and trashed=false`)
    const url = `${API}?q=${q}&fields=nextPageToken,files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const j = await res.json()
    if (j.error) throw new Error(JSON.stringify(j.error))
    files.push(...(j.files ?? []))
    pageToken = j.nextPageToken
  } while (pageToken)
  return files
}

type WalkFile = { id: string; name: string; path: string }
async function walk(folderId: string, prefix: string, token: string): Promise<WalkFile[]> {
  const out: WalkFile[] = []
  for (const c of await listChildren(folderId, token)) {
    if (c.mimeType === FOLDER) out.push(...await walk(c.id, prefix ? `${prefix}/${c.name}` : c.name, token))
    else out.push({ id: c.id, name: c.name, path: prefix })
  }
  return out
}

async function trash(id: string, token: string) {
  const res = await fetch(`${API}/${id}?supportsAllDrives=true`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
  const j = await res.json()
  if (j.error) throw new Error(JSON.stringify(j.error))
}

function folderIdFromUrl(url: string | null): string | null {
  return url?.match(/folders\/([-\w]+)/)?.[1] ?? null
}

async function main() {
  const { data: ws } = await supa.from('workspaces').select('slug, drive_folder_id, config_extra').eq('id', WS_ID).single()
  if (!ws?.drive_folder_id) throw new Error('Workspace sin drive_folder_id')
  const ce = (ws.config_extra ?? {}) as Record<string, string>
  const token = await getToken(
    ce.drive_client_id ?? process.env.GOOGLE_DRIVE_CLIENT_ID!,
    ce.drive_client_secret ?? process.env.GOOGLE_DRIVE_CLIENT_SECRET!,
    ce.drive_refresh_token ?? process.env.GOOGLE_DRIVE_REFRESH_TOKEN!,
  )

  const { data: negs } = await supa.from('negocios').select('id, codigo, carpeta_url').eq('workspace_id', WS_ID)
  const negocios = (negs ?? []) as { id: string; codigo: string; carpeta_url: string | null }[]
  const codigoSet = new Set(negocios.map(n => n.codigo))

  console.log(`\n=== Mantenimiento Drive — "${ws.slug}" (${DRY_RUN ? 'DRY RUN' : 'EJECUTANDO'}) ===`)

  // ── (A) DEDUP por negocio ─────────────────────────────────────────────────
  for (const n of negocios) {
    if (SKIP_CODES.has(n.codigo)) { console.log(`\n[dedup] "${n.codigo}" en SKIP_CODES (radicado) — no se toca`); continue }
    if (ONLY_CODES.size > 0 && !ONLY_CODES.has(n.codigo)) continue
    const folderId = folderIdFromUrl(n.carpeta_url)
    if (!folderId) { console.log(`\n[dedup] "${n.codigo}" sin carpeta_url — skip`); continue }
    const { data: bloques } = await supa.from('negocio_bloques').select('data').eq('negocio_id', n.id)
    const refText = (bloques ?? []).map(b => JSON.stringify(b.data ?? {})).join('\n')
    const files = await walk(folderId, '', token)
    const huerfanos = files.filter(f => !refText.includes(f.id))
    console.log(`\n[dedup] "${n.codigo}" (${folderId}): ${files.length} archivo(s), ${huerfanos.length} no referenciado(s)`)
    for (const f of huerfanos) {
      const loc = f.path ? `${f.path}/` : '(raíz)/'
      if (DRY_RUN) { console.log(`   • a papelera: ${loc}${f.name} (${f.id})`); continue }
      try { await trash(f.id, token); console.log(`   🗑 ${loc}${f.name}`) }
      catch (e) { console.log(`   ✗ ${f.name}: ${e}`) }
    }
  }

  // ── (B) STRAY: carpetas de negocios borrados en el root ───────────────────
  // Se salta cuando se acota el alcance (ONLY_CODES) o se pide SKIP_STRAY=true.
  if (ONLY_CODES.size > 0 || process.env.SKIP_STRAY === 'true') {
    console.log('\n[stray] omitido (alcance acotado)')
    console.log('\n=== Fin ===')
    return
  }
  const rootChildren = await listChildren(ws.drive_folder_id, token)
  const stray = rootChildren.filter(f => {
    if (f.mimeType !== FOLDER) return false
    const codigo = f.name.includes(' - ') ? f.name.slice(0, f.name.indexOf(' - ')) : f.name
    return CODIGO_RE.test(codigo) && !codigoSet.has(codigo)
  })
  console.log(`\n[stray] carpetas de negocios inexistentes: ${stray.map(s => s.name).join(', ') || '(ninguna)'}`)
  for (const s of stray) {
    if (DRY_RUN) { console.log(`   • a papelera: "${s.name}" (${s.id})`); continue }
    try { await trash(s.id, token); console.log(`   🗑 "${s.name}"`) }
    catch (e) { console.log(`   ✗ ${s.name}: ${e}`) }
  }

  console.log('\n=== Fin ===')
}

main().catch(e => { console.error('ERROR:', e); process.exit(1) })
