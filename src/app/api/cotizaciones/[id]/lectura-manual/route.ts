/**
 * El ingreso manual de un hotel o un traslado (brief del 2026-09-28), por `fetch` y no por
 * server action: ver `src/lib/cotizaciones/bandeja-red.ts`. La lógica y los permisos son los de
 * `lecturaManualEnBorrador`: no escribe nada, y lo que devuelve va firmado para «Aceptar».
 */
import { NextResponse } from 'next/server'

import { lecturaManualEnBorrador } from '@/app/(app)/negocios/tarifa-pax-actions'
import { registrarEnBandeja, responderBandeja } from '@/lib/cotizaciones/bandeja-registro'

export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let cuerpo: { tipo?: unknown; datos?: unknown } | null = null
  try {
    cuerpo = (await req.json()) as { tipo?: unknown; datos?: unknown }
  } catch {
    cuerpo = null
  }
  if (!id || !cuerpo || (cuerpo.tipo !== 'hotel' && cuerpo.tipo !== 'traslado') || !cuerpo.datos || typeof cuerpo.datos !== 'object') {
    registrarEnBandeja('warn', { ruta: 'lectura-manual', codigo: 'PETICION', cotizacionId: id ?? '', bytesImagen: null })
    return NextResponse.json({ ok: false, codigo: 'PETICION', mensaje: 'El formulario llegó incompleto. Vuelve a enviarlo.' }, { status: 400 })
  }
  const { tipo, datos } = cuerpo
  return NextResponse.json(await responderBandeja('lectura-manual', id, null, () => lecturaManualEnBorrador(id, tipo, datos)))
}
