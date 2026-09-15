/**
 * Borra de Storage los PDF de las aceptaciones del bot que ya cumplieron su
 * plazo de conservación.
 *
 * La purga de las filas NO vive aquí: la corre pg_cron a las 08:00 UTC
 * (`public.purgar_registros_bot()`, migración 20260915060000), es SQL puro y
 * no depende de que esta app esté desplegada. Lo único que SQL no puede hacer
 * es borrar el archivo de Storage, así que deja la ruta en una cola y esto la
 * vacía media hora después. La lógica y su porqué, en
 * `src/lib/retencion-bot/drenar-objetos.ts`.
 *
 * SCHEDULE: diario 08:30 UTC. Hobby solo admite crons diarios (ver
 * limpiar-audio); un día de espera no cambia nada para un plazo que se cuenta
 * en meses.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { drenarObjetosPurgados, type ClienteDrenaje } from '@/lib/retencion-bot/drenar-objetos'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronHeader = req.headers.get('x-vercel-cron')
  if (!cronHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  // La cola y su RPC no estan en los tipos generados de la base.
  const cliente = createServiceClient() as unknown as ClienteDrenaje
  const resultado = await drenarObjetosPurgados(cliente)

  return NextResponse.json(resultado, { status: resultado.ok ? 200 : 502 })
}
