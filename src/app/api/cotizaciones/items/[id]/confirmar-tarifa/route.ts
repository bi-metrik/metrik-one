/**
 * «Aceptar» de la bandeja de capturas (R1, reunión con Edgar y Alejandra del 2026-09-23).
 *
 * POR QUÉ UNA RUTA Y NO LA SERVER ACTION. Next despacha las server actions del cliente EN
 * FILA, una a la vez (`app-router-instance`: `actionQueue.pending`). La bandeja lanza una
 * lectura por pantallazo (`leerCasillaDeItem`, de 8 a 25 s cada una), así que un «Aceptar»
 * tocado mientras había lecturas en curso esperaba detrás de todas: no respondía, el asesor
 * volvía a tocar, y cada toque encolaba otra confirmación. Un `fetch` a esta ruta no entra a
 * esa fila.
 *
 * La lógica y los permisos son los mismos: se llama a `confirmarTarifaPorPasajero`, que lee
 * la sesión y aplica el RLS de siempre y recalcula todo en el servidor (no recibe números).
 */
import { NextResponse } from 'next/server'

import { confirmarTarifaPorPasajero } from '@/app/(app)/negocios/tarifa-pax-actions'

export const runtime = 'nodejs'

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id) return NextResponse.json({ success: false, error: 'Falta la opción.', codigo: 'CONTEXTO' }, { status: 400 })
  const r = await confirmarTarifaPorPasajero(id, null)
  return NextResponse.json({ success: r.success, error: r.error ?? null, codigo: r.codigo ?? null })
}
