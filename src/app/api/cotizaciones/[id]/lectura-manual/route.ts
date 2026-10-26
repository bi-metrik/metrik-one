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
  let cuerpo: { tipo?: unknown; datos?: unknown; porPasos?: unknown } | null = null
  try {
    cuerpo = (await req.json()) as { tipo?: unknown; datos?: unknown; porPasos?: unknown }
  } catch {
    cuerpo = null
  }
  // «✎ Escríbelo a mano» de la cotización por pasos (C5) suma vuelo, actividad y «Otro servicio»;
  // el servidor vuelve a comprobar el interruptor. Sin la marca, solo hotel y traslado, como siempre.
  const porPasos = cuerpo?.porPasos === true
  const tipoValido = cuerpo?.tipo === 'hotel' || cuerpo?.tipo === 'traslado'
    || (porPasos && (cuerpo?.tipo === 'vuelo' || cuerpo?.tipo === 'actividad' || cuerpo?.tipo === 'otro'))
  if (!id || !cuerpo || !tipoValido || !cuerpo.datos || typeof cuerpo.datos !== 'object') {
    registrarEnBandeja('warn', { ruta: 'lectura-manual', codigo: 'PETICION', cotizacionId: id ?? '', bytesImagen: null })
    return NextResponse.json({ ok: false, codigo: 'PETICION', mensaje: 'El formulario llegó incompleto. Vuelve a enviarlo.' }, { status: 400 })
  }
  const { datos } = cuerpo
  const tipo = cuerpo.tipo as 'hotel' | 'traslado' | 'vuelo' | 'actividad' | 'otro'
  return NextResponse.json(await responderBandeja('lectura-manual', id, null, () => porPasos
    ? lecturaManualEnBorrador(id, tipo, datos, { porPasos: true })
    : lecturaManualEnBorrador(id, tipo, datos)))
}
