import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { sincronizarRadar } from '@/lib/radar/sync'
import type { FilaSocrata, ProcesoRadar } from '@/lib/radar/socrata'

/**
 * Cron diario del Radar SECOP: baja el universo de procesos con recepción de ofertas abierta del
 * dataset `p6dx-8zbt` de datos.gov.co y lo deja en `radar_procesos` por upsert sobre `notice_uid`.
 *
 * Es el ÚNICO cron nuevo de la entrega (spec bloque D). Toda la lógica está en
 * `src/lib/radar/sync.ts`, que se prueba sin red ni base; aquí solo van la autorización, el cliente
 * de Supabase y el `fetch`.
 *
 * `radar_procesos` es global: un solo barrido sirve a todos los clientes del módulo. El puntaje NO
 * se calcula aquí — se calcula contra los temas de cada workspace al leer, así que cambiar de temas
 * no obliga a volver a barrer.
 *
 * Schedule: 0 9 * * * (vercel.json), antes de la jornada en Bogotá.
 */

export const runtime = 'nodejs'
// El barrido del 2026-09-28 fueron 2.075 filas en una página; el margen es para un día malo del
// dataset, no para el caso normal.
export const maxDuration = 300

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

  const hoy = todayBogotaISO()

  const resumen = await sincronizarRadar(hoy, {
    traerPagina: async (url) => {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'metrik-one-radar-secop/1.0' },
        // El dataset cambia todos los días y la respuesta es de megabytes: cachearla no sirve.
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`socrata ${res.status}`)
      const cuerpo = (await res.json()) as unknown
      // Socrata responde un objeto con `error` cuando el `$where` no le gusta, no un arreglo. Sin
      // esta guarda, `prepararProcesos` recibiría un objeto, no recorrería nada y el barrido
      // reportaría cero procesos como si el día no tuviera convocatorias.
      if (!Array.isArray(cuerpo)) throw new Error(`socrata respondió ${typeof cuerpo}, no un arreglo`)
      return cuerpo as FilaSocrata[]
    },

    upsert: async (filas: readonly ProcesoRadar[]) => {
      // `radar_procesos` nace en 20260928180000 y no está en `database.ts`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('radar_procesos')
        .upsert(
          filas.map((f) => ({ ...f, visto_at: new Date().toISOString() })),
          { onConflict: 'notice_uid' },
        )
      return error ? error.message : null
    },
  })

  return NextResponse.json(resumen, { status: resumen.ok ? 200 : 500 })
}
