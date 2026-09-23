import { NextResponse } from 'next/server'
import { resolverArchivoCda } from '@/lib/valida-cda/archivo-servidor'

export const dynamic = 'force-dynamic'

/**
 * Descargas de la pestaña Pagos de `/valida` de un CDA: la factura electrónica de una cuota (PDF y
 * XML) y el recibo de un pago.
 *
 *   GET /api/valida/archivo/factura_pdf/<cuota_id>
 *   GET /api/valida/archivo/factura_xml/<cuota_id>
 *   GET /api/valida/archivo/recibo/<cobro_id>
 *
 * Quién puede y qué archivo es lo decide `resolverArchivoCda` (`src/lib/valida-cda/archivo-servidor.ts`),
 * con la MISMA RPC que alimenta la pestaña. Aquí solo se traduce a HTTP: redirect a una URL firmada de
 * 60 s del bucket privado, sin caché. Nunca un enlace de Drive.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ clase: string; id: string }> }) {
  const { clase, id } = await params
  const r = await resolverArchivoCda(clase, id)
  if (r.tipo === 'error') return NextResponse.json({ error: r.error }, { status: r.status })
  const respuesta = NextResponse.redirect(r.url, 302)
  respuesta.headers.set('cache-control', 'no-store')
  return respuesta
}
