/**
 * Endpoint /api/locks/release — usado por navigator.sendBeacon en beforeunload.
 *
 * sendBeacon no admite custom headers ni Promise — solo POST con body.
 * Esta ruta usa la sesion via cookies (same-origin) y suelta el lock.
 */

import { NextRequest, NextResponse } from 'next/server'
import { releaseBloqueLock } from '@/lib/actions/bloque-locks'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  const bloqueId = (body as { bloque_instancia_id?: string }).bloque_instancia_id
  if (!bloqueId) {
    return NextResponse.json(
      { ok: false, error: 'missing_bloque_instancia_id' },
      { status: 400 },
    )
  }
  const res = await releaseBloqueLock(bloqueId)
  return NextResponse.json(res, { status: res.ok ? 200 : 400 })
}
