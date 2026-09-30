import { NextRequest, NextResponse } from 'next/server'

/**
 * Cron de los recordatorios por WhatsApp: cada 15 minutos (su `schedule` está en vercel.json).
 *
 * Esta ruta NO tiene lógica: dispara la acción `recordatorios` de la edge function `wa-alerts`.
 * El trabajo vive allá porque la única puerta de salida a la Graph API de Meta es
 * `supabase/functions/_shared/wa-respond.ts` (es la que deja la fila en `wa_envios` con su
 * acuse), y las edge functions no se pueden importar desde Next. Mandar el mensaje desde aquí
 * significaría un segundo cliente de Meta, sin bitácora — que es exactamente el agujero que
 * `wa_envios` vino a cerrar en agosto.
 *
 * ⚠️ Corre los 365 días del año, domingo y festivo incluidos. La regla del 2026-09-27 (avisos
 * automáticos al cliente solo en día hábil del país del cliente) NO aplica a este tipo: un
 * recordatorio que se salta el domingo es el fallo que el módulo vino a evitar. No meter aquí
 * `esDiaHabil` ni `debeSalirHoy`.
 *
 * ⚠️ Mientras `WA_RECORDATORIOS` no esté en `on` (el default), `wa-alerts` responde
 * `apagado: true` y no manda nada: la plantilla de Meta todavía no existe.
 *
 * Variables que esta ruta necesita en Vercel, además de `CRON_SECRET`:
 *   · `WA_ALERTS_SECRET` — el mismo secreto que ya usan los pg_cron de `wa-alerts` (vive en el
 *     vault de Postgres; hay que copiarlo también al proyecto de Vercel).
 *   · la URL de las funciones se deriva de `NEXT_PUBLIC_SUPABASE_URL`, así que no hay que
 *     declarar otra.
 * Sin `WA_ALERTS_SECRET` la ruta responde 500 y lo dice, en vez de fallar callada.
 */

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronHeader = req.headers.get('x-vercel-cron')

  if (!cronHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const secreto = process.env.WA_ALERTS_SECRET
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!secreto || !base) {
    return NextResponse.json(
      { ok: false, error: 'falta_config', detalle: 'WA_ALERTS_SECRET o NEXT_PUBLIC_SUPABASE_URL' },
      { status: 500 },
    )
  }

  const res = await fetch(`${base.replace(/\/$/, '')}/functions/v1/wa-alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secreto}` },
    body: JSON.stringify({ action: 'recordatorios' }),
    cache: 'no-store',
  })

  const cuerpo = await res.text()
  if (!res.ok) {
    console.error(`[cron recordatorios-wa] wa-alerts respondió ${res.status}: ${cuerpo.slice(0, 300)}`)
    return NextResponse.json({ ok: false, status: res.status }, { status: 500 })
  }

  // El resumen de la función se devuelve tal cual: es lo que se lee en el log del cron.
  let resumen: unknown = cuerpo
  try {
    resumen = JSON.parse(cuerpo)
  } catch {
    // Respuesta sin JSON: se devuelve el texto, que igual dice qué pasó.
  }
  return NextResponse.json({ ok: true, resumen }, { status: 200 })
}
