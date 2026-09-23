import { NextRequest, NextResponse } from 'next/server'
import { atenderWebhookPasarela } from '@/lib/cobros/pago-en-linea-servidor'

export const dynamic = 'force-dynamic'

// Webhook de Bold (pagos de los enlaces de las cuotas). TEMPORAL: cuando se pase a ePayco, su ruta
// será una copia de esta con 'epayco'. La firma la verifica el adaptador de Bold
// (src/lib/suscripciones/pasarela/bold.ts) sobre el cuerpo CRUDO; el registro del pago es el común a
// todas las pasarelas (src/lib/cobros/pago-en-linea.ts). Un route.ts no puede exportar helpers.

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const r = await atenderWebhookPasarela('bold', raw, {
    'x-bold-signature': request.headers.get('x-bold-signature') ?? undefined,
  })
  return NextResponse.json(r.body, { status: r.status })
}
