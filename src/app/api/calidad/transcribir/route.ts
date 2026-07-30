/**
 * Etapa 1 del motor: transcribir y redactar.
 *
 * La REDACCION ocurre aqui, en el servidor, antes de que el texto vuelva al
 * navegador. La transcripcion en claro no sale de esta funcion: lo que viaja de
 * vuelta ya esta redactado. Si la redaccion viviera del lado del cliente, el
 * numero de tarjeta habria estado en el navegador y en la red antes de que
 * alguien lo borrara.
 *
 * EL AUDIO YA NO VIAJA EN EL CUERPO, Y ESO CAMBIO UNA GARANTIA. Antes el
 * archivo llegaba aqui como multipart y no se escribia en ningun lado: el audio
 * en claro no se persistia nunca. Hoy llega su ruta en Storage, donde el
 * navegador lo dejo, y por lo tanto SI existe escrito durante el rato que dura
 * esta funcion. Se borra al final, pase lo que pase, y el barrido de
 * /api/crons/limpiar-audio recoge lo que esta ruta nunca llegue a ver.
 *
 * El borrado va en `finally` y no en el camino feliz. Si colgara del exito,
 * cada transcripcion fallida dejaria un audio en claro tirado en Storage, y el
 * caso de error es justamente el mas probable.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { createServiceClient } from '@/lib/supabase/server'
import { redactarTranscripcion } from '@/lib/calidad/redactar'
import { MAX_BYTES_AUDIO, mensajeAudioMuyPesado } from '@/lib/calidad/tope-audio'
import { transcribirAudio } from '@/lib/calidad/transcribir'
import { BUCKET_AUDIO } from '@/lib/calidad/audio-bucket'

export const runtime = 'nodejs'
// 300 s: el maximo del plan, no un default que se pueda subir. El tope de 30
// minutos de audio se fijo contra este numero con margen 2x. Ver tope-audio.ts.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !role) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  // Auditar una llamada nueva es una accion de supervision, no de operacion.
  if (!getRolePermissions(role).canViewCalidadTodos) {
    return NextResponse.json({ error: 'Sin permiso para auditar llamadas' }, { status: 403 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'El motor de auditoría no está configurado.' }, { status: 503 })
  }

  const { ruta } = (await req.json()) as { ruta?: string }
  if (!ruta) {
    return NextResponse.json({ error: 'Falta el audio.' }, { status: 400 })
  }

  // La ruta la propone el cliente, asi que se trata como entrada hostil: tiene
  // que caer dentro del prefijo de SU workspace. Sin esto, un supervisor podria
  // pedir la transcripcion del audio de otro workspace con solo cambiar el
  // texto que manda. El prefijo no es decoracion: es el control de acceso.
  if (!ruta.startsWith(`${workspaceId}/`) || ruta.includes('..')) {
    return NextResponse.json({ error: 'Audio no encontrado.' }, { status: 404 })
  }

  const supabase = createServiceClient()

  try {
    const { data: blob, error: eBajar } = await supabase.storage.from(BUCKET_AUDIO).download(ruta)
    if (eBajar || !blob) {
      return NextResponse.json(
        { error: 'No se encontró el audio subido. Vuelve a intentarlo.' },
        { status: 404 },
      )
    }

    // El peso REAL, medido sobre lo que de verdad se subio. Lo que dijo el
    // cliente al pedir el permiso de subida era una promesa; esto es el hecho.
    if (blob.size > MAX_BYTES_AUDIO) {
      return NextResponse.json({ error: mensajeAudioMuyPesado(blob.size) }, { status: 413 })
    }

    const audio = Buffer.from(await blob.arrayBuffer())
    const t = await transcribirAudio(audio, blob.type || 'audio/mpeg', apiKey)
    const red = redactarTranscripcion(t.texto)

    return NextResponse.json({
      transcripcion: red.texto,
      turnos: t.turnos,
      redacciones: red.total,
      detalleRedaccion: red.conteo,
      ms: t.ms,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Falló la transcripción.' },
      { status: 502 },
    )
  } finally {
    // Pase lo que pase. Un fallo al borrar no puede tumbar una transcripcion
    // que salio bien, asi que se traga la excepcion: para eso esta el barrido.
    try {
      await supabase.storage.from(BUCKET_AUDIO).remove([ruta])
    } catch {
      /* lo recoge /api/crons/limpiar-audio */
    }
  }
}
