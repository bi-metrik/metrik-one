import { NextRequest, NextResponse } from 'next/server'
import { resolverApertura } from '@/lib/almacenamiento/abrir'
import { enlaceTemporalOne, SEGUNDOS_ENLACE_ONE } from '@/lib/almacenamiento/one'
import { esReferenciaOne } from '@/lib/almacenamiento/referencia'
import { dependenciasDeSesion } from '@/lib/almacenamiento/sesion'
import { almacenamientoExternoDe, SEGUNDOS_ENLACE } from '@/lib/almacenamiento/supabase-externo'

// GET /api/archivos/abrir?ref=<referencia>[&descargar=1]
//
// Todo enlace de la pantalla a un archivo guardado por referencia pasa por aquí, sea
// del proyecto del cliente (`sbext://`) o de los buckets de ONE (`one://`). Valida
// sesión y workspace, firma por 5 minutos y redirige. La URL firmada no se guarda en
// ningún lado: vence, y guardarla dejaría enlaces muertos en la base.
//
// El criterio vive en `src/lib/almacenamiento/abrir.ts` (probado) y la validación de
// acceso es la MISMA que usa la vista del repositorio. Lo único que se decide aquí es
// QUIÉN firma, que es lo que no se puede probar sin red.

export const dynamic = 'force-dynamic'

const SIN_CACHE = { 'cache-control': 'no-store' }

export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref')
  const descargar = req.nextUrl.searchParams.get('descargar') === '1'

  const r = await resolverApertura(ref, descargar, {
    ...dependenciasDeSesion(),
    async firmar(workspaceId, referencia, opciones) {
      // Un bucket de ONE lo firma el cliente de servicio del propio proyecto. No pasa
      // por `almacenamientoExternoDe`: ese resuelve el proyecto del CLIENTE, y un
      // workspace en Drive (que son casi todos) no tiene ninguno.
      if (esReferenciaOne(referencia)) {
        return enlaceTemporalOne(referencia, SEGUNDOS_ENLACE_ONE, opciones)
      }
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
