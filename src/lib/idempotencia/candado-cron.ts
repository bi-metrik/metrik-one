import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Un cron de Vercel corre UNA vez aunque la invocación llegue dos veces.
 *
 * Vercel no garantiza entrega única de un cron, y medido el 2026-10-06 los avisos de
 * `inactividad_*` salían en pares a menos de 6 s (soena, trappvel, afi): dos corridas cruzadas,
 * cada una preguntando «¿ya hay aviso pendiente?» antes de que la otra insertara.
 *
 * El candado se toma al empezar con `tomar_candado` (un solo INSERT ... ON CONFLICT en la base:
 * dos a la vez no pueden tomarlo las dos) y NO se suelta al terminar: vence solo. Así una
 * segunda entrega que llegue cuando la primera ya acabó tampoco corre. Todos los crons de
 * `vercel.json` son diarios, y el candado dura 15 min.
 *
 * Para correrlo a mano otra vez dentro de esos 15 min: `Authorization: Bearer $CRON_SECRET` y
 * `?forzar=1`. Sin la migración (tabla o función ausentes) o con la base caída al tomarlo, el
 * cron corre como siempre: el candado protege, no impide trabajar.
 *
 * Uso, después de la autenticación del cron:
 *
 *     const ocupado = await candadoDeCron('inactividad-oportunidades', req)
 *     if (ocupado) return ocupado
 */

const DURACION_S = 15 * 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: { code?: string; message: string } | null }> }

export async function candadoDeCron(
  nombre: string,
  req: Request,
  opciones: { svc?: Cliente } = {},
): Promise<NextResponse | null> {
  const url = new URL(req.url)
  const conSecreto = !!process.env.CRON_SECRET && req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  if (conSecreto && url.searchParams.get('forzar') === '1') return null

  const svc: Cliente = opciones.svc ?? createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const { data, error } = await svc.rpc('tomar_candado', { p_clave: `cron:${nombre}`, p_segundos: DURACION_S })
  if (error) {
    console.warn(`[cron ${nombre}] sin candado (${error.message}): corre sin protección`)
    return null
  }
  if (data === true) return null
  console.info(`[cron ${nombre}] otra corrida tiene el candado: esta no corre`)
  return NextResponse.json({ ok: true, omitido: 'otra_corrida_reciente', cron: nombre })
}
