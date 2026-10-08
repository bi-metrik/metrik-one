import { NextResponse } from 'next/server'
import { correoAlCrearNegocio } from '@/lib/autorizacion-datos/servidor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * El correo con el link de autorización al crear un viaje, para los viajes que abre el bot (edge
 * function de WhatsApp). Los que se crean en la app lo mandan directo desde la acción.
 *
 * Sin sesión ni secreto A PROPÓSITO: la ruta solo actúa sobre un negocio creado hace menos de
 * 15 minutos y pasa por la misma decisión que el envío automático (workspace encendido, contacto
 * con correo y sin autorización, sin un correo reciente). Lo peor que puede provocar quien conozca
 * el id de un negocio recién creado es el correo que el sistema habría mandado solo, una vez.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { negocio_id?: unknown }
  const negocioId = typeof body.negocio_id === 'string' ? body.negocio_id.trim() : ''
  if (!UUID.test(negocioId)) return NextResponse.json({ error: 'negocio_id' }, { status: 400 })
  const r = await correoAlCrearNegocio(negocioId)
  return NextResponse.json(r.enviado ? { enviado: true } : { enviado: false, motivo: r.motivo })
}
