import { NextRequest, NextResponse } from 'next/server'
import { atenderWebhookBoldFunciones } from '@/lib/funciones/webhook-bold-funciones'

export const dynamic = 'force-dynamic'

// Webhook de Bold para los pagos de funciones de UN workspace, con la llave secreta de ese workspace (bóveda de
// llaves). No es `/api/webhooks/bold`, que es de las cuotas de MéTRIK. La lógica vive en
// `src/lib/funciones/webhook-bold-funciones.ts`: un route.ts no puede exportar helpers.

export async function POST(request: NextRequest, { params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params
  const raw = await request.text()
  const r = await atenderWebhookBoldFunciones(workspace, raw, request.headers.get('x-bold-signature'))
  return NextResponse.json(r.body, { status: r.status })
}
