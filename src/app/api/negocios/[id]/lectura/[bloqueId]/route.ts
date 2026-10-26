/**
 * `GET /api/negocios/<id>/lectura/<bloqueId>` — cómo va la lectura de un documento.
 *
 * `procesarDocumento` y `reprocesarDocumento` responden en cuanto validan y dejan la lectura
 * corriendo después de responder (ver `src/lib/documentos/lectura-en-curso.ts`). La tarjeta
 * pregunta aquí hasta ver la marca terminada. Es GET de ruta y no server action a propósito:
 * las actions van en fila y esta consulta se repite (gotcha #1019).
 *
 * Sin sesión: 401 (el cliente se va al flujo de sesión). Bloque ajeno o inexistente: 404.
 */
import { NextResponse } from 'next/server'
import { consultarLectura } from '@/lib/documentos/consultar-lectura'
import { enPeticionDeRuta } from '@/lib/actions/memo-de-ruta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIN_CACHE = { 'Cache-Control': 'no-store' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; bloqueId: string }> }) {
  const { id, bloqueId } = await params
  if (!UUID.test(id) || !UUID.test(bloqueId)) {
    return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400, headers: SIN_CACHE })
  }
  try {
    const res = await enPeticionDeRuta(() => consultarLectura(id, bloqueId))
    if (res.error === 'No autenticado') {
      return NextResponse.json(res, { status: 401, headers: SIN_CACHE })
    }
    if (res.error) return NextResponse.json(res, { status: 404, headers: SIN_CACHE })
    return NextResponse.json(res, { headers: SIN_CACHE })
  } catch (e) {
    console.error('[api/negocios/lectura]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo leer el estado del documento' }, { status: 500, headers: SIN_CACHE })
  }
}
