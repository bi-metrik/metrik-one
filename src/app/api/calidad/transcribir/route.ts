/**
 * Etapa 1 del motor: transcribir y redactar.
 *
 * La REDACCION ocurre aqui, en el servidor, antes de que el texto vuelva al
 * navegador. El audio en claro nunca se persiste y la transcripcion en claro no
 * sale de esta funcion: lo que viaja de vuelta ya esta redactado. Si la
 * redaccion viviera del lado del cliente, el numero de tarjeta habria estado en
 * el navegador y en la red antes de que alguien lo borrara.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { redactarTranscripcion } from '@/lib/calidad/redactar'
import { MAX_BYTES_AUDIO, mensajeAudioMuyPesado } from '@/lib/calidad/tope-audio'
import { transcribirAudio } from '@/lib/calidad/transcribir'

export const runtime = 'nodejs'
// 300 s: el presupuesto real de este proyecto (Fluid compute activo). Si no se
// declara, la funcion hereda el default y puede cortar antes.
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

  const form = await req.formData()
  const archivo = form.get('audio')

  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo de audio.' }, { status: 400 })
  }

  // El tope se valida TAMBIEN aqui, no solo en el navegador: el cliente puede
  // mentir. Pero esta validacion es la segunda linea, no la primera: por encima
  // de 4.500.000 bytes la plataforma corta el cuerpo antes de que este archivo
  // se ejecute, y entonces quien responde es ella y no nosotros. La defensa que
  // de verdad protege al usuario vive en el navegador; esta cubre el resto.
  if (archivo.size > MAX_BYTES_AUDIO) {
    return NextResponse.json({ error: mensajeAudioMuyPesado(archivo.size) }, { status: 413 })
  }

  try {
    const audio = Buffer.from(await archivo.arrayBuffer())
    const t = await transcribirAudio(audio, archivo.type || 'audio/mpeg', apiKey)
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
  }
}
