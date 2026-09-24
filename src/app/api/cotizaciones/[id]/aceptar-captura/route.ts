/**
 * «Aceptar» de la bandeja de capturas (H2 y H3 de la prueba del 2026-09-24): lleva a
 * Componentes una captura que hasta ahora solo vivía en la bandeja como borrador firmado.
 *
 * POR QUÉ UNA RUTA Y NO LA SERVER ACTION: Next despacha las server actions del cliente en
 * fila, y la bandeja tiene lecturas de 8 a 25 s en curso; un «Aceptar» por server action
 * esperaba detrás de todas (R1, ver `items/[id]/confirmar-tarifa`). Un `fetch` no entra a esa
 * fila.
 *
 * La lógica y los permisos son los de `aceptarCapturaDeBandeja`: verifica la firma de la
 * lectura (nada sin firmar llega a Componentes), lee la sesión y aplica el RLS de siempre, y
 * decide contra la cotización de ESE momento dónde queda la captura.
 */
import { NextResponse } from 'next/server'

import { aceptarCapturaDeBandeja, type BorradorParaAceptar } from '@/app/(app)/negocios/tarifa-pax-actions'

export const runtime = 'nodejs'

const DECISIONES = new Set(['auto', 'opcion', 'habitacion', 'reemplazar'])

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let cuerpo: Partial<BorradorParaAceptar> | null = null
  try {
    cuerpo = (await req.json()) as Partial<BorradorParaAceptar>
  } catch {
    cuerpo = null
  }
  if (
    !id ||
    !cuerpo ||
    typeof cuerpo.tipo !== 'string' ||
    typeof cuerpo.lecturaJson !== 'string' ||
    typeof cuerpo.firma !== 'string' ||
    !DECISIONES.has(String(cuerpo.decision))
  ) {
    return NextResponse.json({ ok: false, codigo: 'PETICION', mensaje: 'La captura llegó incompleta. Vuelve a pegarla.' }, { status: 400 })
  }
  const r = await aceptarCapturaDeBandeja(id, {
    tipo: cuerpo.tipo,
    lecturaJson: cuerpo.lecturaJson,
    firma: cuerpo.firma,
    pistas: cuerpo.pistas ?? { lugar: null, origen: null, destino: null },
    decision: cuerpo.decision as BorradorParaAceptar['decision'],
    destinoId: typeof cuerpo.destinoId === 'string' ? cuerpo.destinoId : null,
    imagen: typeof cuerpo.imagen === 'string' ? cuerpo.imagen : null,
    correcciones: Array.isArray(cuerpo.correcciones)
      ? cuerpo.correcciones.filter(c => !!c && typeof c.slug === 'string' && typeof c.valor === 'string')
      : null,
  })
  return NextResponse.json(r)
}
