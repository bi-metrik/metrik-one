import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { candadoDeCron } from '@/lib/idempotencia/candado-cron'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { correrRecordatorios } from '@/lib/recordatorios/motor'
import { aplicarPrerreservaVencida, prerreservasVencidas } from '@/lib/viaje/confirmacion-datos'
import { duplicarCotizacionCompleta } from '@/lib/cotizaciones/duplicar-cotizacion'

// Motor de recordatorios hacia atrás (post-cotización, PR 4).
//
// Schedule: diario 07:30 Bogotá = 12:30 UTC (vercel.json). Ningún aviso sale entre las 8 p. m. y
// las 7 a. m. (Vera §7.7): la hora del cron es la única hora de envío.
//
// Gobernado por `lineas_negocio.config_extra.recordatorios.activo` (ausente = apagado). Sin
// ninguna línea encendida, la corrida lee una tabla y termina.
//
// Para correrlo a mano: `Authorization: Bearer $CRON_SECRET` (y `?forzar=1` dentro de los 15 min
// del candado). `?hoy=YYYY-MM-DD` simula el día, solo con el secreto (viaje de prueba, F8).

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronHeader = req.headers.get('x-vercel-cron')
  const conSecreto = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`

  if (!cronHeader && !conSecreto) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const otraCorrida = await candadoDeCron('recordatorios', req)
  if (otraCorrida) return otraCorrida

  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )

  const simulado = new URL(req.url).searchParams.get('hoy')
  const hoy = conSecreto && simulado && /^\d{4}-\d{2}-\d{2}$/.test(simulado) ? simulado : todayBogotaISO()

  try {
    const resumen = await correrRecordatorios(svc, { hoy })
    const prerreservas = await vencerPrerreservas(svc)
    return NextResponse.json({ ok: true, hoy, ...resumen, prerreservas_vencidas: prerreservas })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[cron recordatorios]', msg)
    return NextResponse.json({ ok: false, hoy, error: msg }, { status: 500 })
  }
}

/**
 * Prerreservas vencidas sin anticipo (F2, Vera C9): en la primera pasada del día. La ficha cubre el
 * resto del día al abrir el negocio. Solo líneas con `plan_pagos.activo`; idempotente.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function vencerPrerreservas(svc: any): Promise<number> {
  const ahoraMs = Date.now()
  let aplicadas = 0
  for (const p of await prerreservasVencidas(svc, ahoraMs)) {
    try {
      const r = await aplicarPrerreservaVencida(svc, {
        ...p,
        ahoraMs,
        duplicar: async (cotizacionId) => {
          const d = await duplicarCotizacionCompleta(svc, { workspaceId: p.workspaceId, cotizacionId, negocioId: p.negocioId })
          return d.ok ? { ok: true, id: d.id } : { ok: false, error: d.error }
        },
      })
      if (r.aplicada) aplicadas++
    } catch (e) {
      console.error('[cron recordatorios] prerreserva', p.negocioId, e instanceof Error ? e.message : e)
    }
  }
  return aplicadas
}
