/**
 * Backfill de documentos atascados en Supabase Storage → Google Drive.
 *
 * Barre los bloques `documento` de un workspace (por slug) cuyo
 * `data->>'drive_url'` apunta a Storage (el archivo se quedó ahí porque el
 * negocio no tenía carpeta de Drive al subirlo) y, para cada uno, invoca el
 * helper idempotente `pushDocumentoBloqueToDrive`: los organiza en la carpeta
 * del negocio con su nombre y subcarpeta definidos, y borra el temporal.
 *
 * Sólo procesa bloques PRIMARIOS (config sin `source_etapa_orden`). Los bloques
 * readonly heredados apuntan al MISMO archivo de Storage que su origen; si se
 * procesaran, intentarían descargar/borrar el mismo temporal dos veces. Su
 * archivo se resuelve por herencia al renderizar, así que su URL stale es
 * cosmética.
 *
 * Reejecutable: los bloques ya en Drive se saltan (idempotencia del helper).
 *
 * Uso:
 *   npx tsx scripts/backfill-negocio-documentos.ts <slug>
 *
 * Requiere en .env.local del repo:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - (Drive) GOOGLE_DRIVE_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN
 *     o credenciales per-workspace en workspaces.config_extra.drive_*
 *     o modo service account (drive_auth_mode='service_account')
 */

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'
import { pushDocumentoBloqueToDrive } from '@/lib/negocios/push-documento-drive'

config({ path: resolve(process.cwd(), '.env.local') })

const slug = process.argv[2]

if (!slug) {
  console.error('Uso: npx tsx scripts/backfill-negocio-documentos.ts <slug>')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Faltan env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

interface BloqueRow {
  id: string
  negocio_id: string
  data: Record<string, unknown> | null
  bloque_configs: {
    config_extra: Record<string, unknown> | null
    bloque_definitions: { tipo: string } | null
  } | null
}

async function main() {
  console.log(`\n→ Buscando workspace "${slug}"...`)
  const { data: wsRaw, error: errWs } = await sb
    .from('workspaces')
    .select('id, slug, name')
    .eq('slug', slug)
    .single()

  if (errWs || !wsRaw) {
    console.error(`Workspace "${slug}" no encontrado:`, errWs?.message)
    process.exit(1)
  }
  const ws = wsRaw as { id: string; slug: string; name: string }
  console.log(`  ws.id = ${ws.id} (${ws.name})`)

  const { data: negRaw, error: errNeg } = await sb
    .from('negocios')
    .select('id, codigo')
    .eq('workspace_id', ws.id)

  if (errNeg) {
    console.error('Fallo al listar negocios:', errNeg.message)
    process.exit(1)
  }
  const negocios = (negRaw ?? []) as Array<{ id: string; codigo: string | null }>
  const codigoPorNegocio = Object.fromEntries(negocios.map(n => [n.id, n.codigo]))
  const negIds = negocios.map(n => n.id)

  if (negIds.length === 0) {
    console.log('  (workspace sin negocios)')
    return
  }

  console.log(`\n→ Barriendo bloques documento con drive_url en Storage...`)
  const { data: bloqueRaw, error: errBloque } = await sb
    .from('negocio_bloques')
    .select('id, negocio_id, data, bloque_configs(config_extra, bloque_definitions(tipo))')
    .in('negocio_id', negIds)

  if (errBloque) {
    console.error('Fallo al listar bloques:', errBloque.message)
    process.exit(1)
  }

  const bloques = (bloqueRaw ?? []) as unknown as BloqueRow[]

  // Filtrar a bloques documento PRIMARIOS con drive_url en Storage.
  const objetivo = bloques.filter(b => {
    if (b.bloque_configs?.bloque_definitions?.tipo !== 'documento') return false
    const cfg = b.bloque_configs?.config_extra ?? {}
    // Saltar readonly heredados: apuntan al mismo archivo de Storage que su origen.
    if (cfg.source_etapa_orden != null) return false
    const url = b.data?.drive_url
    return typeof url === 'string' && url.includes('/storage/')
  })

  console.log(`  ${objetivo.length} bloque(s) documento primario(s) en Storage`)

  let pushed = 0
  let skip = 0
  let errores = 0
  const porNegocio: Record<string, { pushed: number; skip: number; error: number }> = {}

  for (const b of objetivo) {
    const codigo = codigoPorNegocio[b.negocio_id] ?? b.negocio_id.slice(0, 8)
    const cfg = b.bloque_configs?.config_extra ?? {}
    const label = (cfg.label as string | undefined) ?? (b.data?.file_name as string | undefined) ?? '(sin label)'
    porNegocio[codigo] ??= { pushed: 0, skip: 0, error: 0 }

    try {
      const res = await pushDocumentoBloqueToDrive(sb, ws.id, b.id)
      if (res.pushed) {
        pushed++
        porNegocio[codigo].pushed++
        console.log(`  ✓ ${codigo} · ${label} → Drive (${res.drive_url})`)
      } else if (res.reason === 'error' || res.reason === 'no_encontrado') {
        errores++
        porNegocio[codigo].error++
        console.log(`  ✗ ${codigo} · ${label} → error (${res.reason})`)
      } else {
        skip++
        porNegocio[codigo].skip++
        console.log(`  – ${codigo} · ${label} → skip (${res.reason})`)
      }
    } catch (e) {
      errores++
      porNegocio[codigo].error++
      console.log(`  ✗ ${codigo} · ${label} → excepción: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  console.log(`\n→ Resumen por negocio:`)
  for (const [codigo, r] of Object.entries(porNegocio).sort()) {
    console.log(`  ${codigo}: ${r.pushed} organizado(s), ${r.skip} skip, ${r.error} error(es)`)
  }
  console.log(`\n✓ Total: ${pushed} organizado(s), ${skip} skip, ${errores} error(es)`)
}

main().catch(e => {
  console.error('\n✗ ERROR:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
