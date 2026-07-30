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
 * admite tarda unos 140 s y el techo de la funcion son 300 s, asi que a las 2
 * horas no queda nada legitimo en vuelo. Borrar antes seria arriesgarse a
 * quitarle el archivo a una transcripcion que todavia esta corriendo.
 *
 * Schedule: cada 6 horas (vercel.json).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { BUCKET_AUDIO } from '@/lib/calidad/audio-bucket'

export const runtime = 'nodejs'
export const maxDuration = 60

/** Nada legitimo sigue en vuelo despues de esto. */
const HORAS_GRACIA = 2

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronHeader = req.headers.get('x-vercel-cron')
  if (!cronHeader && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const corte = Date.now() - HORAS_GRACIA * 60 * 60 * 1000

  // El bucket esta organizado por workspace: {workspaceId}/{uuid}.ext. El
  // listado de la raiz devuelve los prefijos, no los archivos, asi que hay que
  // bajar un nivel por cada uno.
  const { data: prefijos, error: eRaiz } = await supabase.storage
    .from(BUCKET_AUDIO)
    .list('', { limit: 1000 })

  if (eRaiz) {
    return NextResponse.json({ error: eRaiz.message }, { status: 502 })
  }

  const huerfanos: string[] = []

  for (const prefijo of prefijos ?? []) {
    const { data: objetos } = await supabase.storage
      .from(BUCKET_AUDIO)
      .list(prefijo.name, { limit: 1000 })

    for (const o of objetos ?? []) {
      // `created_at` puede venir vacio en objetos subidos por URL firmada. Un
      // objeto sin fecha NO se borra: preferimos dejar basura a borrarle el
      // archivo a una transcripcion en curso, que se veria como un fallo
      // aleatorio e irreproducible del producto.
      const nacido = o.created_at ? Date.parse(o.created_at) : NaN
      if (Number.isFinite(nacido) && nacido < corte) {
        huerfanos.push(`${prefijo.name}/${o.name}`)
      }
    }
  }

  if (huerfanos.length === 0) {
    return NextResponse.json({ ok: true, borrados: 0 })
  }

  const { error: eBorrar } = await supabase.storage.from(BUCKET_AUDIO).remove(huerfanos)
  if (eBorrar) {
    return NextResponse.json({ error: eBorrar.message, intentados: huerfanos.length }, { status: 502 })
  }

  return NextResponse.json({ ok: true, borrados: huerfanos.length })
}
