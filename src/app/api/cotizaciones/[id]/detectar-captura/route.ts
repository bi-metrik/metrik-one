/**
 * «¿De qué es este pantallazo?» para la bandeja de capturas, por `fetch` y no por server
 * action: ver `src/lib/cotizaciones/bandeja-red.ts`. La lógica y los permisos son los de
 * `detectarCaptura` (sesión, RLS y la puerta del módulo Clarity).
 */
import { NextResponse } from 'next/server'

import { detectarCaptura } from '@/app/(app)/negocios/ranura-actions'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let cuerpo: { dataUrl?: unknown } | null = null
  try {
    cuerpo = (await req.json()) as { dataUrl?: unknown }
  } catch {
    cuerpo = null
  }
  if (!id || !cuerpo || typeof cuerpo.dataUrl !== 'string') {
    return NextResponse.json({ ok: false, codigo: 'IMAGEN', mensaje: 'La imagen no llegó en un formato legible. Vuelve a pegarla.' }, { status: 400 })
  }
  return NextResponse.json(await detectarCaptura(id, cuerpo.dataUrl))
}
