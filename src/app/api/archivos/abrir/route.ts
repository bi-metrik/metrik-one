import { NextRequest, NextResponse } from 'next/server'
import { resolverApertura } from '@/lib/almacenamiento/abrir'
import { dependenciasDeSesion } from '@/lib/almacenamiento/sesion'
import { almacenamientoExternoDe, SEGUNDOS_ENLACE } from '@/lib/almacenamiento/supabase-externo'

// GET /api/archivos/abrir?ref=sbext://one-documentos/negocios/<id>/...[&descargar=1]
//
// Todo enlace de la pantalla a un archivo en almacenamiento externo pasa por aquí.
// Valida sesión y workspace, firma por 5 minutos y redirige. La URL firmada no se
// guarda en ningún lado: vence, y guardarla dejaría enlaces muertos en la base.
// El criterio vive en `src/lib/almacenamiento/abrir.ts` (probado) y la validación de
// acceso es la MISMA que usa la vista del repositorio.

export const dynamic = 'force-dynamic'

const SIN_CACHE = { 'cache-control': 'no-store' }

export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref')
  const descargar = req.nextUrl.searchParams.get('descargar') === '1'

  const r = await resolverApertura(ref, descargar, {
    ...dependenciasDeSesion(),
    async firmar(workspaceId, referencia, opciones) {
      const almacenamiento = await almacenamientoExternoDe(workspaceId)
      if (!almacenamiento) return null
      return almacenamiento.enlaceTemporal(referencia, SEGUNDOS_ENLACE, opciones)
    },
  })

  if (r.tipo === 'redirigir') {
    return NextResponse.redirect(r.url, { status: 302, headers: SIN_CACHE })
  }

  if (r.status >= 500) console.error(`[archivos/abrir] ${r.mensaje}`)
  return new NextResponse(r.mensaje, {
    status: r.status,
    headers: { ...SIN_CACHE, 'content-type': 'text/plain; charset=utf-8' },
  })
}
