/**
 * Backfill de carpetas de Drive para negocios sin carpeta.
 *
 * Barre los negocios de un workspace (por slug) con `carpeta_url IS NULL` y,
 * para cada uno, invoca el helper idempotente `ensureNegocioDriveFolder`.
 * Reejecutable: los negocios que ya tienen carpeta se saltan (idempotencia).
 *
 * Uso:
 *   npx tsx scripts/backfill-negocio-folders.ts <slug>
 *
 * Requiere en .env.local del repo:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - (Drive) GOOGLE_DRIVE_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN
 *     o credenciales per-workspace en workspaces.config_extra.drive_*
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
import { ensureNegocioDriveFolder } from '@/lib/negocios/ensure-drive-folder'

config({ path: resolve(process.cwd(), '.env.local') })

const slug = process.argv[2]

if (!slug) {
  console.error('Uso: npx tsx scripts/backfill-negocio-folders.ts <slug>')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

async function main() {
  console.log(`\n→ Buscando workspace "${slug}"...`)
  const { data: wsRaw, error: errWs } = await sb
    .from('workspaces')
    .select('id, slug, name, drive_folder_id')
    .eq('slug', slug)
    .single()

  if (errWs || !wsRaw) {
    console.error(`Workspace "${slug}" no encontrado:`, errWs?.message)
    process.exit(1)
  }
  const ws = wsRaw as { id: string; slug: string; name: string; drive_folder_id: string | null }
  console.log(`  ws.id = ${ws.id} (${ws.name})`)
  console.log(`  drive_folder_id workspace: ${ws.drive_folder_id ?? '(null)'}`)

  console.log(`\n→ Barriendo negocios con carpeta_url IS NULL...`)
  const { data: negociosRaw, error: errNeg } = await sb
    .from('negocios')
    .select('id, codigo')
    .eq('workspace_id', ws.id)
    .is('carpeta_url', null)
    .order('created_at', { ascending: true })

  if (errNeg) {
    console.error(`Fallo al listar negocios:`, errNeg.message)
    process.exit(1)
  }

  const negocios = (negociosRaw ?? []) as Array<{ id: string; codigo: string | null }>
  console.log(`  ${negocios.length} negocio(s) sin carpeta`)

  let creadas = 0
  let skip = 0
  let errores = 0

  for (const neg of negocios) {
    const label = neg.codigo ?? neg.id.slice(0, 8)
    try {
      const res = await ensureNegocioDriveFolder(sb, ws.id, neg.id)
      if (res.created) {
        creadas++
        console.log(`  ✓ ${label} → creada (${res.carpeta_url})`)
      } else if (res.reason === 'sin_parent') {
        skip++
        console.log(`  – ${label} → skip (sin drive_folder_id padre)`)
      } else if (res.reason === 'ya_tiene') {
        skip++
        console.log(`  – ${label} → skip (ya tenía carpeta)`)
      } else {
        errores++
        console.log(`  ✗ ${label} → error (${res.reason})`)
      }
    } catch (e) {
      errores++
      console.log(`  ✗ ${label} → excepción: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.log(`\n✓ Resumen: ${creadas} creada(s), ${skip} skip, ${errores} error(es)`)
}

main().catch(e => {
  console.error('\n✗ ERROR:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
