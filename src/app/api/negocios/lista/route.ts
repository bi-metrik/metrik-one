/**
 * `GET /api/negocios/lista?<filtros de la URL>&desde=N` — la lista de `/negocios` para
 * unos filtros: el resumen ya contado y UNA página de tarjetas desde `desde`.
 *
 * `&solo=ids` devuelve los ids de la lista visible completa, en su orden: es lo que
 * mandan «Descargar Excel» y «Subir a Drive» (antes los tenía el navegador porque tenía
 * la lista entera; ya no la tiene).
 *
 * Mismo origen que la primera carga (`cargarVistaLista`), así que filtrar por aquí y
 * recargar la página dan lo mismo. Solo lectura: acota por workspace y rol igual que
 * `getNegociosV2` (un operator solo ve sus negocios).
 */
import { NextRequest, NextResponse } from 'next/server'
import { cargarVistaLista, idsDeVistaLista } from '@/lib/negocios/cargar-vista-lista'
import type { SearchParams } from '@/lib/filtros/url-estado'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIN_CACHE = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  const sp: SearchParams = Object.fromEntries(req.nextUrl.searchParams.entries())

  if (sp.solo === 'ids') {
    const ids = await idsDeVistaLista(sp)
    if (!ids) return NextResponse.json({ error: 'No autenticado' }, { status: 401, headers: SIN_CACHE })
    return NextResponse.json({ ids }, { headers: SIN_CACHE })
  }

  const desde = Number(sp.desde ?? 0)
  const cuantos = sp.cuantos === undefined ? undefined : Number(sp.cuantos)
  const vista = await cargarVistaLista(sp, {
    desde: Number.isFinite(desde) ? desde : 0,
    cuantos: cuantos !== undefined && Number.isFinite(cuantos) ? cuantos : undefined,
  })
  if (!vista) return NextResponse.json({ error: 'No autenticado' }, { status: 401, headers: SIN_CACHE })
  return NextResponse.json(vista, { headers: SIN_CACHE })
}
