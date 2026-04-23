// Sirve el HTML de un workflow con Content-Type: text/html correcto.
// Supabase Storage devuelve text/plain aunque el mime guardado sea text/html
// cuando la signed URL se fetchea directamente.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getWorkspace } from '@/lib/actions/get-workspace'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const { id } = await ctx.params
  const svc = createServiceClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wf } = await ((svc as any).from('admin_workflows'))
    .select('html_storage_path')
    .eq('id', id)
    .maybeSingle()

  if (!wf?.html_storage_path) {
    return new NextResponse('Not found', { status: 404 })
  }

  const { data: blob, error: dlErr } = await svc.storage
    .from('workflows')
    .download(wf.html_storage_path)

  if (dlErr || !blob) {
    return new NextResponse('Download error', { status: 500 })
  }

  const buffer = Buffer.from(await blob.arrayBuffer())
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=60',
    },
  })
}
