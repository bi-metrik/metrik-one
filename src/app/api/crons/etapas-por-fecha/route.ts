import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { candadoDeCron } from '@/lib/idempotencia/candado-cron'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { correrEtapasPorFecha } from '@/lib/viaje/etapas-por-fecha'

// Entrar y salir de «En viaje» por fechas (post-cotización F6-1, diseño técnico §6).
//
// Schedule: diario 06:00 Bogotá = 11:00 UTC (vercel.json), antes del motor de recordatorios.
//
// Gobernado por `lineas_negocio.config_extra.etapas_por_fecha` (ausente = la línea no se toca).
//
// Prueba en producción (F8): `?simular_hoy=YYYY-MM-DD&negocio_id=…` SOLO con
// `Authorization: Bearer $CRON_SECRET` y SOLO si ese negocio tiene `metadata.es_prueba = true`;
// la corrida simulada no toca ningún otro negocio.

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronHeader = req.headers.get('x-vercel-cron')
  const conSecreto = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`
  if (!cronHeader && !conSecreto) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const simular = url.searchParams.get('simular_hoy')
  const negocioId = url.searchParams.get('negocio_id')

  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  let hoy = todayBogotaISO()
  let soloNegocioId: string | null = null
  if (simular) {
    if (!conSecreto || !/^\d{4}-\d{2}-\d{2}$/.test(simular) || !negocioId) {
      return NextResponse.json({ error: 'simular_hoy pide el secreto y un negocio_id de prueba' }, { status: 400 })
    }
    const { data } = await svc.from('negocios').select('metadata').eq('id', negocioId).maybeSingle()
    if ((data as { metadata?: { es_prueba?: unknown } } | null)?.metadata?.es_prueba !== true) {
      return NextResponse.json({ error: 'simular_hoy solo corre sobre un negocio de prueba (metadata.es_prueba)' }, { status: 400 })
    }
    hoy = simular
    soloNegocioId = negocioId
  } else {
    const otraCorrida = await candadoDeCron('etapas-por-fecha', req)
    if (otraCorrida) return otraCorrida
  }

  try {
    const resumen = await correrEtapasPorFecha(svc, { hoy, soloNegocioId })
    return NextResponse.json({ ok: true, hoy, ...resumen })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[cron etapas-por-fecha]', msg)
    return NextResponse.json({ ok: false, hoy, error: msg }, { status: 500 })
  }
}
