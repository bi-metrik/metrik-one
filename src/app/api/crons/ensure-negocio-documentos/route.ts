import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { pushDocumentoBloqueToDrive } from '@/lib/negocios/push-documento-drive'

// Reconciliador continuo de documentos atascados en Supabase Storage.
//
// Barre bloques `documento` cuyo `data->>'drive_url'` apunta a Storage
// (el archivo se quedó ahí porque el negocio no tenía carpeta de Drive al
// momento de subirlo) y para cada uno invoca el helper idempotente
// `pushDocumentoBloqueToDrive`: los organiza en la carpeta del negocio con
// su nombre y subcarpeta definidos, y borra el temporal.
//
// Depende del reconciliador de carpetas (`ensure-negocio-folders`): si el
// negocio aún no tiene carpeta_url, el helper retorna 'sin_carpeta' y este
// doc se resolverá en la próxima corrida (una vez creada la carpeta).
//
// Sólo procesa bloques PRIMARIOS (config sin `source_etapa_orden`). Los
// readonly heredados apuntan al mismo archivo de Storage que su origen; su
// archivo se resuelve por herencia al renderizar.
//
// Batch limitado (50 por corrida) para no reventar el timeout de la función.
// Idempotente y re-ejecutable.
//
// Auth: header x-vercel-cron (cron de Vercel) o Authorization: Bearer CRON_SECRET.

export const maxDuration = 60

const BATCH_LIMIT = 50

interface BloqueRow {
  id: string
  negocio_id: string
  data: Record<string, unknown> | null
  bloque_configs: {
    config_extra: Record<string, unknown> | null
    bloque_definitions: { tipo: string } | null
  } | null
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

  // Workspaces con carpeta padre configurada (drive_folder_id no-null).
  const { data: wsData, error: wsErr } = await supabase
    .from('workspaces')
    .select('id')
    .not('drive_folder_id', 'is', null)

  if (wsErr) {
    return NextResponse.json({ error: wsErr.message }, { status: 500 })
  }

  const wsIds = ((wsData ?? []) as Array<{ id: string }>).map(w => w.id)
  if (wsIds.length === 0) {
    return NextResponse.json({ checked: 0, pushed: 0, skipped: 0, errors: 0, results: [] })
  }

  // Negocios (con carpeta) de esos workspaces.
  const { data: negData, error: negErr } = await supabase
    .from('negocios')
    .select('id, codigo, workspace_id')
    .in('workspace_id', wsIds)
    .not('carpeta_url', 'is', null)

  if (negErr) {
    return NextResponse.json({ error: negErr.message }, { status: 500 })
  }

  const negocios = (negData ?? []) as Array<{ id: string; codigo: string | null; workspace_id: string }>
  const metaPorNegocio = new Map(negocios.map(n => [n.id, n]))
  const negIds = negocios.map(n => n.id)

  if (negIds.length === 0) {
    return NextResponse.json({ checked: 0, pushed: 0, skipped: 0, errors: 0, results: [] })
  }

  // Bloques documento de esos negocios.
  const { data: bloqueData, error: bloqueErr } = await supabase
    .from('negocio_bloques')
    .select('id, negocio_id, data, bloque_configs(config_extra, bloque_definitions(tipo))')
    .in('negocio_id', negIds)
    .order('created_at', { ascending: true })

  if (bloqueErr) {
    return NextResponse.json({ error: bloqueErr.message }, { status: 500 })
  }

  const bloques = (bloqueData ?? []) as unknown as BloqueRow[]

  // Filtrar a documento PRIMARIO con drive_url en Storage, y limitar el batch.
  const objetivo = bloques
    .filter(b => {
      if (b.bloque_configs?.bloque_definitions?.tipo !== 'documento') return false
      const cfg = b.bloque_configs?.config_extra ?? {}
      if (cfg.source_etapa_orden != null) return false
      const url = b.data?.drive_url
      return typeof url === 'string' && url.includes('/storage/')
    })
    .slice(0, BATCH_LIMIT)

  let pushed = 0
  let skipped = 0
  let errors = 0
  const results: Array<{ codigo: string | null; result: string }> = []

  for (const b of objetivo) {
    const meta = metaPorNegocio.get(b.negocio_id)
    try {
      const res = await pushDocumentoBloqueToDrive(supabase, meta!.workspace_id, b.id)
      if (res.pushed) {
        pushed++
        results.push({ codigo: meta?.codigo ?? null, result: 'pushed' })
      } else if (res.reason === 'error' || res.reason === 'no_encontrado') {
        errors++
        results.push({ codigo: meta?.codigo ?? null, result: `error:${res.reason}` })
      } else {
        skipped++
        results.push({ codigo: meta?.codigo ?? null, result: res.reason ?? 'skipped' })
      }
    } catch (e) {
      errors++
      results.push({ codigo: meta?.codigo ?? null, result: `error: ${e instanceof Error ? e.message : String(e)}` })
    }
  }

  return NextResponse.json({
    checked: objetivo.length,
    pushed,
    skipped,
    errors,
    batch_limit: BATCH_LIMIT,
    results,
  })
}
