import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { firmaValida } from '../../../../../supabase/functions/_shared/entrega-bloqueo-firma.ts'
import { procesarPedido, procesarRespuesta, responderTipo, type Salida } from '@/lib/cotizaciones/entrega-unica/flujo'
import { llamadorAnthropic } from '@/lib/cotizaciones/entrega-unica/llamada'
import { puertoSupabase } from '@/lib/cotizaciones/entrega-unica/puerto-supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Una llamada al modelo tarda 25-74 s (prueba del 2026-11-04) y puede haber un segundo armado si el chequeo frena el
// primero; más el PDF con Chromium.
export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * ENTREGA ÚNICA DEL BLOQUEO: el webhook de WhatsApp le pasa aquí un pedido ya anclado (`entregas_bloqueo`)
 * y recibe los mensajes que tiene que mandarle a la ASESORA (nunca a la clienta). Sin sesión: el cuerpo
 * llega firmado con la llave de servicio (`entrega-bloqueo-firma.ts`).
 *
 *   { accion: 'pedido', entregaId }                       → la llamada al modelo y el guardado en ONE
 *   { accion: 'respuesta', entregaId, texto }             → aplica su respuesta, chequeo y PDF
 *   { accion: 'tipo', entregaId, tipo: 'bloqueo'|'a_medida' }
 */
export async function POST(request: Request) {
  const cuerpo = await request.text()
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!(await firmaValida(llave, cuerpo, request.headers.get('x-firma-entrega')))) {
    return NextResponse.json({ error: 'firma' }, { status: 401 })
  }
  let p: { accion?: string; entregaId?: string; texto?: string; tipo?: string }
  try { p = JSON.parse(cuerpo) } catch { return NextResponse.json({ error: 'json' }, { status: 400 }) }
  if (!p.entregaId || !UUID.test(p.entregaId)) return NextResponse.json({ error: 'entregaId' }, { status: 400 })

  const deps = {
    puerto: puertoSupabase(createServiceClient(), { baseDominio: process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co' }),
    modelo: llamadorAnthropic,
  }
  let salidas: Salida[]
  if (p.accion === 'pedido') salidas = await procesarPedido(p.entregaId, deps)
  else if (p.accion === 'respuesta' && typeof p.texto === 'string') salidas = await procesarRespuesta(p.entregaId, p.texto.slice(0, 4000), deps)
  else if (p.accion === 'tipo' && (p.tipo === 'bloqueo' || p.tipo === 'a_medida')) salidas = await responderTipo(p.entregaId, p.tipo, deps)
  else return NextResponse.json({ error: 'accion' }, { status: 400 })
  return NextResponse.json({ salidas })
}
