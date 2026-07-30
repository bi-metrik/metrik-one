/**
 * Barrido del buzon de audio.
 *
 * POR QUE HACE FALTA, SI /transcribir YA BORRA. Porque el borrado de aquella
 * ruta solo ocurre si aquella ruta llega a correr. El navegador sube el archivo
 * ANTES de pedir la transcripcion, asi que basta con que alguien suba y cierre
 * la pestaña, o pierda la conexion en medio, para que ese audio se quede en
 * Storage sin que nadie vuelva a mirarlo nunca.
 *
 * "Borrado inmediato" sin este barrido es una promesa que se incumple sola el
 * primer dia. Esto es la diferencia entre decir que borramos y borrar.
 *
 * El umbral es holgado a proposito: la transcripcion mas larga que el producto
 * admite tarda unos 120 s y el techo de la funcion son 300 s, asi que a las 2
 * horas no queda nada legitimo en vuelo. Borrar antes seria arriesgarse a
 * quitarle el archivo a una transcripcion que todavia esta corriendo.
 *
 * SCHEDULE: DIARIO 04:00 UTC, Y NO ES UN CAPRICHO. El plan hobby solo admite
 * crons diarios: un cron cada 6 horas hace que Vercel rechace el build ENTERO
 * con `cron_jobs_limits_reached`, y el sintoma no es un aviso sino que el
 * deploy de produccion no aparece por ningun lado. Nos paso.
 *
 * Como 24 horas es mucho para una grabacion que prometimos borrar enseguida, el
 * barrido que de verdad importa ocurre en /api/calidad/audio-url cada vez que
 * alguien sube. Esto de aqui es la red de abajo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { BUCKET_AUDIO, huerfanos } from '@/lib/calidad/audio-bucket'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronHeader = req.headers.get('x-vercel-cron')
  if (!cronHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const ahora = Date.now()

  // El bucket esta organizado por workspace: {workspaceId}/{uuid}.ext. El
  // listado de la raiz devuelve los prefijos, no los archivos, asi que hay que
  // bajar un nivel por cada uno.
  const { data: prefijos, error: eRaiz } = await supabase.storage
    .from(BUCKET_AUDIO)
    .list('', { limit: 1000 })

  if (eRaiz) {
    return NextResponse.json({ error: eRaiz.message }, { status: 502 })
  }

  const sobran: string[] = []

  for (const prefijo of prefijos ?? []) {
    const { data: objetos } = await supabase.storage
      .from(BUCKET_AUDIO)
      .list(prefijo.name, { limit: 1000 })

    // La regla de que es un huerfano vive en `audio-bucket.ts`, compartida con
    // el barrido oportunista de /api/calidad/audio-url. Dos copias de esta
    // regla se separarian, y la que se quedara atras borraria de mas o de
    // menos sin que nadie lo notara.
    sobran.push(...huerfanos(objetos ?? [], ahora).map((n) => `${prefijo.name}/${n}`))
  }

  if (sobran.length === 0) {
    return NextResponse.json({ ok: true, borrados: 0 })
  }

  const { error: eBorrar } = await supabase.storage.from(BUCKET_AUDIO).remove(sobran)
  if (eBorrar) {
    return NextResponse.json({ error: eBorrar.message, intentados: sobran.length }, { status: 502 })
  }

  return NextResponse.json({ ok: true, borrados: sobran.length })
}
