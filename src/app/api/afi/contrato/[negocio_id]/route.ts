// Endpoint POST /api/afi/contrato/[negocio_id]
// Dispara el motor de armado del contrato modular AFI ↔ Cliente.
// Requiere sesion owner/admin del workspace afi.

import { NextRequest, NextResponse } from 'next/server'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { generarContratoAFI } from '@/lib/afi/generar-contrato'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ negocio_id: string }> }
) {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (role !== 'owner' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { negocio_id } = await ctx.params

  const svc = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neg } = await (svc as any).from('negocios')
    .select('id, workspace_id').eq('id', negocio_id).maybeSingle()
  if (!neg) return NextResponse.json({ error: 'Negocio no encontrado' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ws } = await (svc as any).from('workspaces').select('slug').eq('id', neg.workspace_id).single()
  if (ws?.slug !== 'afi') return NextResponse.json({ error: 'Solo disponible en workspace afi' }, { status: 403 })

  const result = await generarContratoAFI(negocio_id)
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
