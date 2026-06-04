import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Receptor del webhook de CCBF (metrik-valida). Mantiene el espejo local
// kyc_expediente_ref del estado de cada expediente de Vinculacion de Contrapartes.
//
// Seguridad: HMAC-SHA256 del cuerpo crudo con KYC_WEBHOOK_SECRET (mismo secreto
// que firma valida en lib/kyc/sync.ts) en el header x-kyc-signature.
// Escribe con service_role (bypasea RLS); valida_one nunca expone esta ruta a clientes.

type PayloadKyc = {
  evento: string
  expediente_kyc_id: string
  workspace_one_id: string | null
  estado: string
  etapa_actual: string
  severidad?: string | null
  decision?: Record<string, unknown> | null
  razon_social?: string | null
  emitido_en: string
}

function firmaValida(raw: string, recibida: string | null, secret: string): boolean {
  if (!recibida) return false
  const esperado = createHmac('sha256', secret).update(raw).digest('hex')
  const a = Buffer.from(esperado, 'utf8')
  const b = Buffer.from(recibida, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function POST(request: NextRequest) {
  const secret = process.env.KYC_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'webhook_no_configurado' }, { status: 503 })
  }

  const raw = await request.text()
  if (!firmaValida(raw, request.headers.get('x-kyc-signature'), secret)) {
    return NextResponse.json({ error: 'firma_invalida' }, { status: 401 })
  }

  let payload: PayloadKyc
  try {
    payload = JSON.parse(raw) as PayloadKyc
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!payload.expediente_kyc_id || !payload.workspace_one_id || !payload.estado) {
    return NextResponse.json({ error: 'payload_incompleto' }, { status: 400 })
  }

  // kyc_expediente_ref aun no esta en los tipos generados (database.ts). Cast puntual,
  // mismo patron que el cron drive-health. Pendiente: regenerar tipos + re-agregar aliases.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceClient() as any
  const { error } = await supabase
    .from('kyc_expediente_ref')
    .upsert(
      {
        workspace_id: payload.workspace_one_id,
        expediente_kyc_id: payload.expediente_kyc_id,
        razon_social: payload.razon_social ?? null,
        estado_cache: payload.estado,
        etapa_cache: payload.etapa_actual ?? null,
        severidad_cache: payload.severidad ?? null,
        decision_cache: payload.decision ?? null,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: 'expediente_kyc_id' },
    )

  if (error) {
    return NextResponse.json({ error: 'db_error', message: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
