import { NextRequest, NextResponse } from 'next/server'
import { atenderWebhookPasarela } from '@/lib/cobros/pago-en-linea-servidor'
import { cuerpoConfirmacionEpayco } from '@/lib/suscripciones/pasarela/epayco'

export const dynamic = 'force-dynamic'

// URL de confirmación de ePayco (pagos de los links de las cuotas). La misma ruta que la de Bold con
// 'epayco': la firma la verifica el adaptador (src/lib/suscripciones/pasarela/epayco.ts) y el registro
// del pago es el común a todas las pasarelas (src/lib/cobros/pago-en-linea.ts). ePayco confirma por
// POST (form) o por GET según el link; la referencia de ONE viaja en la consulta (`?ref=`).

async function atender(request: NextRequest, cuerpo: string) {
  const crudo = cuerpoConfirmacionEpayco(cuerpo, request.headers.get('content-type'), request.nextUrl.searchParams)
  const r = await atenderWebhookPasarela('epayco', crudo, {})
  return NextResponse.json(r.body, { status: r.status })
}

export async function POST(request: NextRequest) {
  return atender(request, await request.text())
}

export async function GET(request: NextRequest) {
  return atender(request, '')
}
