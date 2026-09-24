/**
 * La lectura firmada de un pantallazo de la bandeja, por `fetch` y no por server action: ver
 * `src/lib/cotizaciones/bandeja-red.ts`. La lógica y los permisos son los de
 * `leerCapturaEnBorrador`: no escribe nada, y lo que devuelve va firmado para «Aceptar».
 */
import { NextResponse } from 'next/server'

import { leerCapturaEnBorrador } from '@/app/(app)/negocios/tarifa-pax-actions'
import type { TipoRanura } from '@/lib/cotizaciones/ranuras-cotizacion'

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
    return NextResponse.json({ ok: false, codigo: 'PETICION', mensaje: 'La captura llegó incompleta. Vuelve a pegarla.' }, { status: 400 })
  }
  const e = cuerpo.enfoque
  const enfoque = e && typeof e.nombre === 'string'
    ? { nombre: e.nombre.slice(0, 200), precio: typeof e.precio === 'string' ? e.precio.slice(0, 60) : null }
    : null
  // `leerCapturaEnBorrador` valida el tipo: uno desconocido vuelve con su mensaje.
  return NextResponse.json(await leerCapturaEnBorrador(id, cuerpo.tipo as TipoRanura, cuerpo.dataUrl, enfoque))
}
