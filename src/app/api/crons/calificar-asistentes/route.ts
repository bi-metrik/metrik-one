/**
 * Calificación diaria de las conversaciones de los asistentes (spec 2026-10-26, §4.4). La lógica, el interruptor por
 * workspace y lo que recibe el juez, en `src/lib/asistentes/calificacion.ts`.
 *
 * SCHEDULE: diario 11:30 UTC = 6:30 de Bogotá, con lo del día anterior; antes del resumen (12:00 UTC).
 *
 * `?fecha=AAAA-MM-DD` (con `Authorization: Bearer $CRON_SECRET`) califica otro día; `?forzar=1` salta el candado para
 * terminar una corrida que se quedó sin tiempo (las ya calificadas se saltan).
 */
import { NextRequest, NextResponse } from 'next/server'
import { candadoDeCron } from '@/lib/idempotencia/candado-cron'
import { createServiceClient } from '@/lib/supabase/server'
import { calificarDia } from '@/lib/asistentes/calificacion'
import { juezHaiku, puertoCalificacionSupabase } from '@/lib/asistentes/calificacion-servidor'
import { fechaAyerBogota } from '@/lib/asistentes/conversaciones'

export const runtime = 'nodejs'
export const maxDuration = 300

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
  const otraCorrida = await candadoDeCron('calificar-asistentes', req)
  if (otraCorrida) return otraCorrida

  try {
    const resultado = await calificarDia(fecha, {
      puerto: puertoCalificacionSupabase(createServiceClient()),
      juez: juezHaiku,
    })
    if (resultado.errores.length) console.warn('[calificar-asistentes]', resultado.errores.slice(0, 20))
    return NextResponse.json(resultado, { status: resultado.ok ? 200 : 207 })
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e)
    console.error('[calificar-asistentes] no corrió:', mensaje)
    return NextResponse.json({ ok: false, fecha, error: mensaje }, { status: 502 })
  }
}
