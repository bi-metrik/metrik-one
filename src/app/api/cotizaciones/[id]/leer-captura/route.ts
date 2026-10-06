/**
 * La lectura firmada de un pantallazo de la bandeja, por `fetch` y no por server action: ver
 * `src/lib/cotizaciones/bandeja-red.ts`. La lógica y los permisos son los de
 * `leerCapturaEnBorrador`: no escribe nada, y lo que devuelve va firmado para «Aceptar».
 */
import { NextResponse } from 'next/server'

import { leerCapturaEnBorrador } from '@/app/(app)/negocios/tarifa-pax-actions'
import type { TipoRanura } from '@/lib/cotizaciones/ranuras-cotizacion'
import { bytesDeImagen, registrarEnBandeja, responderBandeja } from '@/lib/cotizaciones/bandeja-registro'

export const runtime = 'nodejs'
export const maxDuration = 60

interface Cuerpo {
  tipo?: unknown
  dataUrl?: unknown
  enfoque?: { nombre?: unknown; precio?: unknown } | null
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let cuerpo: Cuerpo | null = null
  try {
    cuerpo = (await req.json()) as Cuerpo
  } catch {
    cuerpo = null
  }
  if (!id || !cuerpo || typeof cuerpo.tipo !== 'string' || typeof cuerpo.dataUrl !== 'string') {
    registrarEnBandeja('warn', { ruta: 'leer-captura', codigo: 'PETICION', cotizacionId: id ?? '', bytesImagen: bytesDeImagen(cuerpo?.dataUrl) })
    return NextResponse.json({ ok: false, codigo: 'PETICION', mensaje: 'La captura llegó incompleta. Vuelve a pegarla.' }, { status: 400 })
  }
  const e = cuerpo.enfoque
  const enfoque = e && typeof e.nombre === 'string'
    ? { nombre: e.nombre.slice(0, 200), precio: typeof e.precio === 'string' ? e.precio.slice(0, 60) : null }
    : null
  const { tipo, dataUrl } = cuerpo
  // `leerCapturaEnBorrador` valida el tipo: uno desconocido vuelve con su mensaje. Caso Alejandra
  // (2026-10-05): todo `ok:false` con mensaje y con su línea en el log.
  return NextResponse.json(await responderBandeja('leer-captura', id, bytesDeImagen(dataUrl), () => leerCapturaEnBorrador(id, tipo as TipoRanura, dataUrl, enfoque)))
}
