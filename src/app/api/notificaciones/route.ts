/**
 * `GET /api/notificaciones?desde=N` — las pendientes de la campana: una página desde `desde`
 * y el total. Responde 304 si el navegador ya tiene esa misma respuesta (ETag).
 *
 * Antes la campana las pedía con la server action `getNotificaciones`: 6.136 llamadas en 7
 * días (medido 2026-10-05), casi todas al volver a la pestaña. Next pone las server actions
 * en fila, así que esa lectura retrasaba la acción real que venía detrás. Un GET no entra en
 * esa fila, y con el ETag la mayoría de las veces vuelve sin cuerpo.
 *
 * `Cache-Control: private, no-cache`: el navegador la guarda, pero la revalida SIEMPRE con
 * `If-None-Match`; ningún CDN la comparte. Las escrituras (completar, descartar, marcar
 * todas) siguen siendo server actions.
 *
 * Misma lectura y mismo alcance que la action: `getNotificaciones`, que filtra por el
 * usuario de la sesión. Sin sesión: 401 (el cliente se va al flujo de sesión). Corre dentro
 * de `enPeticionDeRuta` para resolver la sesión una vez.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getNotificaciones } from '@/lib/actions/notificaciones'
import { enPeticionDeRuta } from '@/lib/actions/memo-de-ruta'
import { coincideEtag, etagDe } from '@/lib/http/etag'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CACHE = 'private, no-cache'
/** Más allá de esto nadie pagina a mano: evita un `range` absurdo. */
const MAX_DESDE = 10_000

export async function GET(req: NextRequest) {
  try {
    return await enPeticionDeRuta(() => leer(req))
  } catch (e) {
    console.error('[api/notificaciones]', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: 'No se pudieron leer las notificaciones' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

async function leer(req: NextRequest) {
  const { error } = await getWorkspace()
  if (error === 'No autenticado') {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }

  const crudo = Number(req.nextUrl.searchParams.get('desde') ?? 0)
  const desde = Number.isInteger(crudo) && crudo >= 0 ? Math.min(crudo, MAX_DESDE) : 0

  const cuerpo = JSON.stringify(await getNotificaciones(desde))
  const etag = etagDe(cuerpo)
  if (coincideEtag(req.headers.get('if-none-match'), etag)) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': CACHE } })
  }
  return new NextResponse(cuerpo, {
    status: 200,
    headers: { 'Content-Type': 'application/json', ETag: etag, 'Cache-Control': CACHE },
  })
}
