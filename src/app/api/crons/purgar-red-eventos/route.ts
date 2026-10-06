/**
 * Purga diaria de `red_eventos` (piloto de red): borra lo de más de 90 días.
 *
 * Con 100 personas entran ~11.000 filas al día; sin purga la tabla crece sin techo. 90 días
 * alcanzan para el antes/después del piloto y para comparar meses.
 *
 * SCHEDULE: diario (vercel.json). Autoriza `x-vercel-cron` o `Bearer CRON_SECRET`, como el resto.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

const DIAS_RETENCION_RED = 90

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronHeader = req.headers.get('x-vercel-cron')
  if (!cronHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  const limite = new Date(Date.now() - DIAS_RETENCION_RED * 86_400_000).toISOString()
  const svc = createServiceClient()
  const { error, count } = await svc.from('red_eventos').delete({ count: 'exact' }).lt('ocurrido_at', limite)
  if (error) {
    console.error('[purgar-red-eventos]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ borrados: count ?? 0, antes_de: limite })
}
