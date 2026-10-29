/**
 * El documento que recibe el cliente, para VERLO en «Revisar y enviar» (H4 de la verificación D,
 * criterio D7): el mismo PDF que «Descargar PDF», con las mismas props y el mismo motor, servido
 * en línea para que el navegador lo muestre dentro de la pantalla.
 *
 * SOLO LECTURA: `generateCotizacionPDF(id, { vistaPrevia: true })` no guarda el archivo, no lo sube
 * a Drive, no registra la salida y no anota la pérdida de la autorización del dueño. Un borrador
 * (algo impide enviar) sale con su marca de agua, igual que al descargarlo.
 *
 * Va por `fetch` (un `<iframe>`) y no por server action: generar el documento tarda, y una acción
 * haría fila delante de las demás de la pantalla (#907).
 */
import { NextResponse } from 'next/server'

import { generateCotizacionPDF } from '@/app/(app)/negocios/cotizacion-pdf-actions'
import { enPeticionDeRuta } from '@/lib/actions/memo-de-ruta'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { estadoPorPasosDeCotizacion } from '@/lib/cotizaciones/por-pasos-datos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// El documento de Trappvel se compone varias veces por dentro (`compositorDePlantilla`).
export const maxDuration = 60

const SIN_CACHE = { 'cache-control': 'no-store' }

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) return NextResponse.json({ ok: false }, { status: 400, headers: SIN_CACHE })
  // El PDF no mira el interruptor (N4): se lo dice la ruta, para que P12 deje la marca como frena «Enviar».
  const r = await enPeticionDeRuta(async () => {
    const { supabase, error } = await getWorkspace()
    const porPasos = !error && (await estadoPorPasosDeCotizacion(supabase, id).catch(() => null))?.encendido === true
    return generateCotizacionPDF(id, { vistaPrevia: true, porPasos })
  }) as {
    success: boolean
    pdf?: string
    filename?: string
    error?: string
  }
  if (!r.success || !r.pdf) {
    const status = r.error === 'No autenticado' ? 401 : r.error === 'Cotización no encontrada' ? 404 : 422
    return NextResponse.json({ ok: false, mensaje: r.error ?? 'No se pudo armar el documento.' }, { status, headers: SIN_CACHE })
  }
  const nombre = (r.filename ?? 'cotizacion.pdf').replace(/[^\w.\- ]/g, '_')
  return new NextResponse(Buffer.from(r.pdf, 'base64'), {
    headers: {
      ...SIN_CACHE,
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${nombre}"`,
    },
  })
}
