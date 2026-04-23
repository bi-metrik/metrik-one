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

  const original = Buffer.from(await blob.arrayBuffer()).toString('utf-8')

  // Inyectar CSS que oculta los elementos que Mauricio pidio sacar de la vista admin:
  // header interno (MéTRIK lockup + titulo), tabs, legend, tab-catalogo, footer.
  // El HTML original queda intacto para el PDF cliente via skill local.
  const injection = `
<style id="__admin_view_overrides__">
  body > .container > header,
  body > .container > .tabs,
  body > .container > .tabs-border,
  body > .container > #tab-catalogo,
  body > .container > footer,
  #tab-flujo > .legend,
  #tab-flujo > .bloque-legend {
    display: none !important;
  }
  body > .container { padding-top: 8px !important; }
  body { padding-top: 0 !important; }
</style>
</head>`
  const processed = original.replace(/<\/head>/i, injection)

  return new NextResponse(processed, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=60',
    },
  })
}
