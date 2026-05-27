import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { generarPDFMetodologia } from '@/lib/valida/pdf-metodologia';
import { getSegmentacionConfig } from '@/lib/actions/valida-segmentacion';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'no_auth' }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data: profile } = await svc
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single();

  if (!profile?.workspace_id) {
    return Response.json({ error: 'workspace_no_encontrado' }, { status: 404 });
  }
  if (!['owner', 'admin', 'supervisor'].includes(profile.role)) {
    return Response.json({ error: 'permiso_denegado' }, { status: 403 });
  }

  const { data: ws } = await svc
    .from('workspaces')
    .select('name, slug, modules')
    .eq('id', profile.workspace_id)
    .single();

  const modules = (ws?.modules as Record<string, boolean>) ?? {};
  if (!modules.compliance) {
    return Response.json({ error: 'modulo_no_activo' }, { status: 403 });
  }

  const r = await getSegmentacionConfig();
  if (!r.ok) {
    return Response.json({ error: r.error }, { status: 500 });
  }

  if (r.config.version === 0) {
    return Response.json({ error: 'sin_configuracion_aplicada' }, { status: 400 });
  }

  const workspaceNombre = ws?.name ?? ws?.slug ?? 'Workspace sin nombre';

  let aplicadaPorNombre: string | null = null;
  if (r.config.aplicada_por) {
    const { data: aplProfile } = await svc
      .from('profiles')
      .select('full_name')
      .eq('id', r.config.aplicada_por)
      .maybeSingle();
    aplicadaPorNombre = aplProfile?.full_name ?? null;
  }

  const buf = await generarPDFMetodologia({
    workspace_nombre: workspaceNombre,
    config: r.config,
    aplicada_por_nombre: aplicadaPorNombre,
  });

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="metodologia-sarlaft-v${r.config.version}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
