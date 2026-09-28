import { NextRequest, NextResponse } from 'next/server'
import { atenderWebhookWompi } from '@/lib/ferreteria/wompi-servidor'

// URL de eventos del comercio de Wompi de Dimpro. Wompi hace POST con cada cambio de estado de una
// transacción; un pago aprobado de un link con código de publicación (sku) queda como venta de
// Ferretería. La firma se verifica sobre el cuerpo CRUDO con el secreto de eventos; la lógica vive
// en `src/lib/ferreteria/wompi-servidor.ts` (un route.ts no puede exportar helpers).
// Público a propósito: el middleware corta `/api/ferreteria/` antes de pedir sesión.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const r = await atenderWebhookWompi(raw, request.headers.get('x-event-checksum'))
  return NextResponse.json(r.body, { status: r.status, headers: { 'Cache-Control': 'no-store' } })
}
