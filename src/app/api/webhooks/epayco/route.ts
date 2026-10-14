import { NextRequest, NextResponse } from 'next/server'
import { atenderWebhookPasarela } from '@/lib/cobros/pago-en-linea-servidor'

export const dynamic = 'force-dynamic'

// Confirmación de ePayco (`urlConfirmation` de cada cobro). ePayco la manda por POST (formulario o
// JSON) o por GET (en la URL) según `methodConfirmation`; ONE pide POST, y acepta las dos. La firma
// (`x_signature`) la verifica el adaptador (src/lib/suscripciones/pasarela/epayco.ts); el registro del
// pago es el común a todas las pasarelas. Con ePayco apagado (`EPAYCO_HABILITADO`) responde 404.

export async function POST(request: NextRequest) {
  const raw = await request.text()
  const r = await atenderWebhookPasarela('epayco', raw, {})
  return NextResponse.json(r.body, { status: r.status })
}

export async function GET(request: NextRequest) {
  const r = await atenderWebhookPasarela('epayco', request.nextUrl.search, {})
  return NextResponse.json(r.body, { status: r.status })
}
