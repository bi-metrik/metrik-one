import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ensureNegocioDriveFolder } from '@/lib/negocios/ensure-drive-folder'

// Reconciliador continuo de carpetas de Drive.
//
// Barre negocios con `carpeta_url IS NULL` cuyo workspace tenga
// `drive_folder_id` no-null, y para cada uno invoca el helper idempotente
// `ensureNegocioDriveFolder`. Esto garantiza que TODO negocio termine con
// carpeta, sin importar la ruta por la que nació (formulario, webhook de Meta,
// carga manual) — el webhook/insert directo no llaman crearNegocio, así que
// sin este sweep nacerían sin carpeta.
//
// Batch limitado (50 por corrida) para no reventar el timeout de la función.
// Idempotente y re-ejecutable.
//
// Modo puntual (opt-in, retrocompatible): `?negocio_id=<uuid>` resuelve la
// carpeta SOLO para ese negocio, en vez del sweep. Lo usa el webhook de Meta
// para disparar la carpeta al instante en que entra el lead (sin esperar al
// cron diario, que sigue siendo el backstop). Se valida que el negocio exista,
// no tenga carpeta y su workspace tenga `drive_folder_id`. Sin el param →
// comportamiento de sweep de siempre.
//
// Auth: header x-vercel-cron (cron de Vercel) o Authorization: Bearer CRON_SECRET.

export const maxDuration = 60

const BATCH_LIMIT = 50

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

  // ── Modo puntual: ?negocio_id=<uuid> → resuelve solo ese negocio ──
  const negocioIdParam = req.nextUrl.searchParams.get('negocio_id')
  if (negocioIdParam) {
    return handleNegocioPuntual(supabase, negocioIdParam)
  }

  // Workspaces con carpeta padre configurada (drive_folder_id no-null).
  const { data: wsData, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, slug')
    .not('drive_folder_id', 'is', null)

  if (wsErr) {
    return NextResponse.json({ error: wsErr.message }, { status: 500 })
  }

  const workspaces = (wsData ?? []) as Array<{ id: string; slug: string }>
  const wsIds = workspaces.map(w => w.id)

  if (wsIds.length === 0) {
    return NextResponse.json({ checked: 0, created: 0, skipped: 0, errors: 0, results: [] })
  }

  // Negocios sin carpeta de esos workspaces (batch limitado).
  const { data: negData, error: negErr } = await supabase
    .from('negocios')
    .select('id, codigo, workspace_id')
    .is('carpeta_url', null)
    .in('workspace_id', wsIds)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT)

  if (negErr) {
    return NextResponse.json({ error: negErr.message }, { status: 500 })
  }

  const negocios = (negData ?? []) as Array<{ id: string; codigo: string | null; workspace_id: string }>

  let created = 0
  let skipped = 0
  let errors = 0
  const results: Array<{ codigo: string | null; result: string }> = []

  for (const neg of negocios) {
    try {
      const res = await ensureNegocioDriveFolder(supabase, neg.workspace_id, neg.id)
      if (res.created) {
        created++
        results.push({ codigo: neg.codigo, result: 'created' })
      } else {
        skipped++
        results.push({ codigo: neg.codigo, result: res.reason ?? 'skipped' })
      }
    } catch (e) {
      errors++
      results.push({ codigo: neg.codigo, result: `error: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return NextResponse.json({
    checked: negocios.length,
    created,
    skipped,
    errors,
    batch_limit: BATCH_LIMIT,
    results,
  })
}

// Resuelve la carpeta de UN negocio (modo puntual). Valida existencia +
// carpeta_url IS NULL + workspace con drive_folder_id, luego llama al helper
// idempotente. El helper ya maneja idempotencia y sin-padre, pero validamos
// aquí para devolver un status/mensaje claro al llamante (el webhook loguea).
async function handleNegocioPuntual(
  supabase: SupabaseClient,
  negocioId: string,
): Promise<NextResponse> {
  const { data: negData, error: negErr } = await supabase
    .from('negocios')
    .select('id, codigo, carpeta_url, workspace_id')
    .eq('id', negocioId)
    .maybeSingle()

  if (negErr) {
    return NextResponse.json({ error: negErr.message }, { status: 500 })
  }

  const neg = negData as
    | { id: string; codigo: string | null; carpeta_url: string | null; workspace_id: string }
    | null

  if (!neg) {
    return NextResponse.json({ error: 'negocio no encontrado', negocio_id: negocioId }, { status: 404 })
  }

  if (neg.carpeta_url) {
    return NextResponse.json({
      mode: 'puntual',
      negocio_id: negocioId,
      codigo: neg.codigo,
      created: false,
      reason: 'ya_tiene',
      carpeta_url: neg.carpeta_url,
    })
  }

  // El workspace debe tener carpeta padre; si no, el helper registra el skip
  // y nosotros devolvemos 200 (no es un error del llamante, solo no aplica).
  const { data: wsData } = await supabase
    .from('workspaces')
    .select('drive_folder_id')
    .eq('id', neg.workspace_id)
    .maybeSingle()
  const wsDriveFolderId = (wsData as { drive_folder_id: string | null } | null)?.drive_folder_id ?? null

  // Nota: el negocio puede resolver su padre por la línea aunque el workspace
  // no tenga drive_folder_id — por eso NO cortamos aquí si falta el del ws.
  // El helper resuelve línea → fallback workspace y decide.

  try {
    const res = await ensureNegocioDriveFolder(supabase, neg.workspace_id, neg.id)
    return NextResponse.json({
      mode: 'puntual',
      negocio_id: negocioId,
      codigo: neg.codigo,
      created: res.created,
      reason: res.reason,
      carpeta_url: res.carpeta_url,
      ws_drive_folder_id_present: !!wsDriveFolderId,
    })
  } catch (e) {
    return NextResponse.json(
      {
        mode: 'puntual',
        negocio_id: negocioId,
        codigo: neg.codigo,
        created: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    )
  }
}
