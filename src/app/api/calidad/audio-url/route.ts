/**
 * Etapa 0 del motor: entregar permiso de subida, sin recibir el archivo.
 *
 * POR QUE EXISTE ESTA RUTA. El cuerpo de una peticion muere a los 4.500.000
 * bytes: por encima de eso responde la plataforma con un 413 de texto plano
 * antes de que corra una linea nuestra. Mientras el audio viajo dentro de
 * /transcribir, ese fue el techo del producto, unos 17 minutos de llamada.
 *
 * Aqui el archivo deja de pasar por nosotros: esta ruta firma un permiso de
 * subida de un solo uso, el navegador sube DIRECTO a Storage y a la aplicacion
 * solo le llega una ruta de texto. El techo del cuerpo sale del camino.
 *
 * LA CLAVE DE SERVICIO NO SALE DE AQUI. Lo que viaja al navegador es un token
 * de subida acotado a un objeto que todavia no existe, no una credencial.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { createServiceClient } from '@/lib/supabase/server'
import { BUCKET_AUDIO } from '@/lib/calidad/audio-bucket'
import {
  MAX_BYTES_AUDIO,
  MAX_SEGUNDOS_AUDIO,
  mensajeAudioMuyLargo,
  mensajeAudioMuyPesado,
} from '@/lib/calidad/tope-audio'

export const runtime = 'nodejs'

/** Extension del nombre original, saneada. Solo para que el objeto sea legible. */
function extension(nombre: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(nombre.trim())
  return m ? m[1].toLowerCase() : 'audio'
}

export async function POST(req: NextRequest) {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId || !role) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  // Mismo permiso que las otras tres etapas: auditar es supervision.
  if (!getRolePermissions(role).canViewCalidadTodos) {
    return NextResponse.json({ error: 'Sin permiso para auditar llamadas' }, { status: 403 })
  }

  const { nombreArchivo, bytes, segundos } = (await req.json()) as {
    nombreArchivo?: string
    bytes?: number
    segundos?: number
  }

  if (!nombreArchivo || typeof bytes !== 'number' || bytes <= 0) {
    return NextResponse.json({ error: 'Falta la descripción del archivo.' }, { status: 400 })
  }

  // Los dos topes se revisan TAMBIEN aqui, aunque el navegador ya los reviso.
  //
  // Con una diferencia honesta entre ellos: el peso que llega aqui es una
  // promesa del cliente, pero /transcribir lo vuelve a medir sobre el archivo
  // ya descargado, que es donde de verdad se atrapa la mentira. La DURACION,
  // en cambio, no se puede verificar barato en el servidor sin decodificar el
  // audio; su backstop real es el reloj de la funcion, que corta a los 300 s.
  // Por eso el tope de duracion se fijo con margen 2x y no al filo.
  if (bytes > MAX_BYTES_AUDIO) {
    return NextResponse.json({ error: mensajeAudioMuyPesado(bytes) }, { status: 413 })
  }
  if (typeof segundos === 'number' && segundos > MAX_SEGUNDOS_AUDIO) {
    return NextResponse.json({ error: mensajeAudioMuyLargo(segundos) }, { status: 413 })
  }

  // El workspace va en la ruta del objeto: si algun dia alguien agrega una
  // politica de lectura a este bucket, que al menos el prefijo ya separe los
  // workspaces y no haya que rehacer las rutas para poder escribirla.
  const ruta = `${workspaceId}/${randomUUID()}.${extension(nombreArchivo)}`

  const supabase = createServiceClient()
  const { data, error: eStorage } = await supabase.storage
    .from(BUCKET_AUDIO)
    .createSignedUploadUrl(ruta)

  if (eStorage || !data) {
    return NextResponse.json(
      { error: `No se pudo preparar la subida. ${eStorage?.message ?? ''}`.trim() },
      { status: 502 },
    )
  }

  return NextResponse.json({ ruta: data.path, token: data.token })
}
