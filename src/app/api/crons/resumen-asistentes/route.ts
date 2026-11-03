/**
 * Resumen diario de los asistentes por correo (spec 2026-10-26, §4.3). La lógica y de dónde sale cada cifra, en
 * `src/lib/asistentes/resumen.ts`.
 *
 * SCHEDULE: diario 12:00 UTC = 7:00 de Bogotá, con lo del día anterior; media hora después de la calificación
 * (`calificar-asistentes`, 11:30 UTC). Sale aunque no haya actividad: que no llegue avisa que el cron se cayó.
 *
 * Un reintento manda la misma `Idempotency-Key` (`resumen-asistentes:<fecha>`) y Resend no repite el correo.
 * `?fecha=AAAA-MM-DD` (con `Authorization: Bearer $CRON_SECRET`) resume otro día.
 */
import { NextRequest, NextResponse } from 'next/server'
import { candadoDeCron } from '@/lib/idempotencia/candado-cron'
import { createServiceClient } from '@/lib/supabase/server'
import { enviarCorreoInternoPorResend } from '@/lib/cobros/reverso-pasarela-servidor'
import { fechaAyerBogota } from '@/lib/asistentes/conversaciones'
import { enviarResumenDia } from '@/lib/asistentes/resumen'
import { puertoResumenSupabase } from '@/lib/asistentes/resumen-servidor'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronHeader = req.headers.get('x-vercel-cron')
  const conSecreto = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`
  if (!cronHeader && !conSecreto) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const pedida = req.nextUrl.searchParams.get('fecha')
  const fecha = conSecreto && pedida && /^\d{4}-\d{2}-\d{2}$/.test(pedida) ? pedida : fechaAyerBogota(new Date())

  // Una sola corrida aunque Vercel entregue el cron dos veces (ver `candadoDeCron`).
  const otraCorrida = await candadoDeCron('resumen-asistentes', req)
  if (otraCorrida) return otraCorrida

  try {
    const r = await enviarResumenDia(fecha, {
      puerto: puertoResumenSupabase(createServiceClient()),
      enviar: enviarCorreoInternoPorResend,
    })
    if (!r.ok) console.error('[resumen-asistentes] el correo no salió:', r.error)
    return NextResponse.json(r, { status: r.ok ? 200 : 502 })
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e)
    console.error('[resumen-asistentes] no corrió:', mensaje)
    return NextResponse.json({ ok: false, fecha, error: mensaje }, { status: 502 })
  }
}
