import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { esAlmacenamientoExterno, leerConfigAlmacenamiento } from '@/lib/almacenamiento/config'
import { AlmacenamientoSupabaseExterno } from '@/lib/almacenamiento/supabase-externo'

// Salud diaria (y anti-pausa) de los workspaces con almacenamiento externo.
//
// El proyecto Supabase de un cliente en plan Free se PAUSA tras 7 días con poca
// actividad de base de datos. Una semana sin subidas (temporada baja, vacaciones)
// dejaría los archivos inaccesibles justo cuando alguien los necesite. Este cron hace
// cada día una consulta REAL a `archivos_one` y un listado del bucket en cada proyecto.
//
// Si falla (proyecto pausado, tabla ausente, llave rotada, variable faltante) deja una
// línea en el timeline del workspace — mismo patrón visible que `drive-health` — y
// sale en el log de Vercel. Se reutiliza el tipo `drive_health_failed` a propósito:
// un tipo nuevo exige reescribir el CHECK de `activity_log` en producción, y lo que
// importa es que el fallo se vea donde ya se mira el de Drive.
//
// Schedule: diario 13:30 UTC (vercel.json).
// Auth: header x-vercel-cron o Authorization: Bearer CRON_SECRET.

export const maxDuration = 60

type WorkspaceRow = { id: string; slug: string | null; config_extra: Record<string, unknown> | null }

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
    .select('id, slug, config_extra')
    .not('config_extra->>storage_provider', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const workspaces = ((data ?? []) as WorkspaceRow[]).filter(ws => esAlmacenamientoExterno(ws.config_extra))
  const results: Array<{ slug: string | null; ok: boolean; detalle: string; ultima_subida: string | null }> = []

  for (const ws of workspaces) {
    let ok = false
    let detalle = ''
    let ultimaSubida: string | null = null
    try {
      const cfg = leerConfigAlmacenamiento({ slug: ws.slug, configExtra: ws.config_extra, env: process.env })
      if (cfg.proveedor === 'supabase_externo') {
        const r = await new AlmacenamientoSupabaseExterno(cfg.slug, cfg.url, cfg.llave).verificar()
        ok = r.ok
        detalle = r.detalle
        ultimaSubida = r.ultimaSubida
      }
    } catch (e) {
      detalle = e instanceof Error ? e.message : String(e)
    }

    if (!ok) {
      console.error(`[almacenamiento-externo] ${ws.slug}: ${detalle}`)
      try {
        await registrarActividad(supabase, {
          workspace_id: ws.id,
          entidad_tipo: 'workspace',
          entidad_id: ws.id,
          tipo: 'drive_health_failed',
          contenido: `Almacenamiento externo de archivos no responde: ${detalle}`.slice(0, 280),
        }, 'almacenamiento-externo')
      } catch (logErr) {
        console.error('[almacenamiento-externo] no se pudo registrar el fallo en el timeline:', logErr)
      }
    }
    results.push({ slug: ws.slug, ok, detalle, ultima_subida: ultimaSubida })
  }

  const okCount = results.filter(r => r.ok).length
  return NextResponse.json({ checked: results.length, ok: okCount, failed: results.length - okCount, results })
}
