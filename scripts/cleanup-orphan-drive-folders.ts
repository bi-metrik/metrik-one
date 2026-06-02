/**
 * Limpieza de carpetas Drive huérfanas creadas por el bug de documento-actions /
 * formulario-actions (re-creaban la carpeta del negocio por `codigo` a secas en
 * vez de usar negocios.carpeta_url → carpeta gemela "{codigo}" al lado de la
 * canónica "{codigo} - {cliente}").
 *
 * Mueve los archivos de cada huérfana a la canónica (preservando subcarpetas) y
 * envía la huérfana vacía a la papelera (reversible).
 *
 * Uso:
 *   DRY_RUN=true  npx tsx scripts/cleanup-orphan-drive-folders.ts <workspace_id>   (solo reporta)
 *   DRY_RUN=false npx tsx scripts/cleanup-orphan-drive-folders.ts <workspace_id>   (ejecuta)
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

const WS_ID = process.argv[2]
const DRY_RUN = process.env.DRY_RUN !== 'false'
const FOLDER = 'application/vnd.google-apps.folder'
const API = 'https://www.googleapis.com/drive/v3/files'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
if (!WS_ID || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Uso: DRY_RUN=true npx tsx scripts/cleanup-orphan-drive-folders.ts <workspace_id>')
  process.exit(1)
}
const supa = createClient(SUPABASE_URL, SUPABASE_KEY)

async function getToken(cid: string, csec: string, rtok: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cid, client_secret: csec, refresh_token: rtok, grant_type: 'refresh_token' }),
  })
  const j = await res.json()
  if (!j.access_token) throw new Error('OAuth refresh fallo: ' + JSON.stringify(j))
  return j.access_token as string
}

type DriveFile = { id: string; name: string; mimeType: string; parents?: string[] }

async function listChildren(parent: string, token: string): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const q = encodeURIComponent(`'${parent}' in parents and trashed=false`)
    const url = `${API}?q=${q}&fields=nextPageToken,files(id,name,mimeType,parents)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const j = await res.json()
    if (j.error) throw new Error(JSON.stringify(j.error))
    files.push(...(j.files ?? []))
    pageToken = j.nextPageToken
  } while (pageToken)
  return files
}

type WalkFile = { id: string; name: string; parent: string; path: string }
async function walk(folderId: string, prefix: string, token: string): Promise<WalkFile[]> {
  const out: WalkFile[] = []
  for (const c of await listChildren(folderId, token)) {
    if (c.mimeType === FOLDER) out.push(...await walk(c.id, prefix ? `${prefix}/${c.name}` : c.name, token))
    else out.push({ id: c.id, name: c.name, parent: folderId, path: prefix })
  }
  return out
}

async function ensureSubfolderPath(path: string, parentId: string, token: string): Promise<string> {
  if (!path) return parentId
  let current = parentId
  for (const seg of path.split('/')) {
    const q = encodeURIComponent(`'${current}' in parents and name='${seg.replace(/'/g, "\\'")}' and mimeType='${FOLDER}' and trashed=false`)
    const res = await fetch(`${API}?q=${q}&fields=files(id)&supportsAllDrives=true&includeItemsFromAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } })
    const j = await res.json()
    let id = j.files?.[0]?.id as string | undefined
    if (!id) {
      const cr = await fetch(`${API}?supportsAllDrives=true`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: seg, mimeType: FOLDER, parents: [current] }),
      })
      const cj = await cr.json()
      if (!cj.id) throw new Error('No se pudo crear subcarpeta ' + seg + ': ' + JSON.stringify(cj))
      id = cj.id
    }
    current = id!
  }
  return current
}

async function moveFile(fileId: string, addParent: string, removeParent: string, token: string) {
  const res = await fetch(`${API}/${fileId}?addParents=${addParent}&removeParents=${removeParent}&supportsAllDrives=true&fields=id`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}` },
  })
  const j = await res.json()
  if (j.error) throw new Error(JSON.stringify(j.error))
}

async function trashFolder(id: string, token: string) {
  const res = await fetch(`${API}/${id}?supportsAllDrives=true`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
  const j = await res.json()
  if (j.error) throw new Error(JSON.stringify(j.error))
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

  const { data: negs } = await supa.from('negocios').select('codigo').eq('workspace_id', WS_ID)
  const codigos = (negs ?? []).map(n => n.codigo as string).filter(Boolean)
  const codigoSet = new Set(codigos)

  const rootChildren = await listChildren(ws.drive_folder_id, token)
  const folders = rootChildren.filter(f => f.mimeType === FOLDER)
  const orphans = folders.filter(f => codigoSet.has(f.name))
  const canonicalByCodigo: Record<string, string> = {}
  for (const f of folders) for (const c of codigos) if (f.name.startsWith(c + ' - ')) canonicalByCodigo[c] = f.id

  console.log(`\n=== Limpieza Drive — workspace "${ws.slug}" (${DRY_RUN ? 'DRY RUN — solo reporta' : 'EJECUTANDO'}) ===`)
  console.log(`Root: ${ws.drive_folder_id}`)
  console.log(`Negocios (codigos): ${codigos.join(', ') || '(ninguno)'}`)
  console.log(`Carpetas en root: ${folders.map(f => f.name).join('  |  ') || '(ninguna)'}`)
  console.log(`Huérfanas: ${orphans.map(o => o.name).join(', ') || '(NINGUNA — nada que limpiar)'}`)

  for (const orphan of orphans) {
    const canonical = canonicalByCodigo[orphan.name]
    console.log(`\n── Huérfana "${orphan.name}" (${orphan.id}) → canónica: ${canonical ?? '⚠ NO ENCONTRADA'}`)
    if (!canonical) { console.log('   ⚠ Sin carpeta canónica; NO se toca (revisar manualmente).'); continue }
    const files = await walk(orphan.id, '', token)
    console.log(`   ${files.length} archivo(s):`)
    let movedAll = true
    for (const file of files) {
      const loc = file.path ? `${file.path}/` : '(raíz)/'
      if (DRY_RUN) { console.log(`   • ${loc}${file.name}  → canónica/${file.path ? file.path + '/' : ''}`); continue }
      try {
        const dest = await ensureSubfolderPath(file.path, canonical, token)
        await moveFile(file.id, dest, file.parent, token)
        console.log(`   ✓ ${loc}${file.name}`)
      } catch (e) { movedAll = false; console.log(`   ✗ ${file.name}: ${e}`) }
    }
    if (!DRY_RUN && movedAll) {
      const remaining = await walk(orphan.id, '', token)
      if (remaining.length === 0) { await trashFolder(orphan.id, token); console.log('   🗑  Huérfana enviada a papelera.') }
      else console.log(`   ⚠ Quedan ${remaining.length} archivo(s); huérfana NO borrada.`)
    }
  }
  console.log('\n=== Fin ===')
}

main().catch(e => { console.error('ERROR:', e); process.exit(1) })
