import { NextRequest, NextResponse } from 'next/server'
import { correrTrabajadorLotes } from '@/lib/valida/lote-servidor'
import { createServiceClient } from '@/lib/supabase/server'
import { avisarFallaCron, debeVigilarLotes, vigilarLotesValida } from '@/lib/alertas-internas/vigias'

// Trabajador del cargue masivo de Valida (2026-10-15). Ver `src/lib/valida/lote-servidor.ts`.
//
// Schedule: cada minuto (vercel.json). Es la red de seguridad: un lote nuevo lo arranca `after()` en
// la acción que lo crea, y este cron retoma lo que quedó a medias si esa invocación se cortó. Sin
// lotes activos la corrida es una consulta a la base y termina.
//
// SIN `candadoDeCron` a propósito: varias corridas a la vez son el diseño (cada una pide turno a la
// base, que reparte a lo sumo LOTES_SIMULTANEOS), y el candado de 15 min dejaría el lote quieto.
//
// Para correrlo a mano: `Authorization: Bearer $CRON_SECRET`.

export const maxDuration = 300

/** Lo que el trabajador usa de los 300 s: deja margen para responder. */
const PRESUPUESTO_MS = 270_000

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronHeader = req.headers.get('x-vercel-cron')
  const conSecreto = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`
  if (!cronHeader && !conSecreto) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Vigía de cargues quietos (correo interno a MéTRIK), cada 15 min, antes del trabajador: si el trabajador
  // revienta, el vigía igual corrió. Nunca lanza.
  const vigia = debeVigilarLotes(new Date()) ? await vigilarLotesValida(createServiceClient()) : null

  try {
    const resumen = await correrTrabajadorLotes({ presupuestoMs: PRESUPUESTO_MS })
    return NextResponse.json({ ok: true, ...resumen, vigia })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[cron valida-lotes]', msg)
    await avisarFallaCron('valida-lotes', [`trabajador: ${msg}`], { ventana: 'hora' })
    return NextResponse.json({ ok: false, error: msg, vigia }, { status: 500 })
  }
}
