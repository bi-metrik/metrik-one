import { NextRequest } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { generarPDFSoporteDual, type SoporteDualData } from '@/lib/compliance/pdf-soporte-dual';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Sirve el documento de soporte (PDF) de una consulta dual persistida en
// consultas_listas_dual. Se genera 100% desde ONE con los datos ya guardados;
// NO golpea Informa/Valida. La verificacion (hash + QR) queda para una fase posterior.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ consulta_id: string }> },
) {
  const { consulta_id } = await params;

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
  if (!['owner', 'admin', 'supervisor', 'read_only'].includes(profile.role)) {
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

  // Filtra por workspace_id => un workspace no puede leer el soporte de otro.
  const { data: c } = await svc
    .from('consultas_listas_dual')
    .select('id, dual_id, tipo, titulo_lote, tipo_persona, nombre_consultado, documento_tipo, documento_numero, severidad, total_matches, matches, error_mensaje, created_at')
    .eq('id', consulta_id)
    .eq('workspace_id', profile.workspace_id)
    .maybeSingle();

  if (!c) {
    return Response.json({ error: 'consulta_no_encontrada' }, { status: 404 });
  }

  const data: SoporteDualData = {
    workspace_nombre: ws?.name ?? ws?.slug ?? 'Sujeto obligado',
    consulta_local_id: c.id,
    dual_id: c.dual_id ?? null,
    tipo: c.tipo,
    titulo_lote: c.titulo_lote ?? null,
    nombre_consultado: c.nombre_consultado ?? null,
    documento_tipo: c.documento_tipo ?? null,
    documento_numero: c.documento_numero ?? null,
    tipo_persona: c.tipo_persona,
    severidad: c.severidad,
    total_matches: c.total_matches ?? 0,
    matches: Array.isArray(c.matches) ? c.matches : [],
    error_mensaje: c.error_mensaje ?? null,
    created_at: c.created_at,
  };

  const buf = await generarPDFSoporteDual(data);

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="soporte-consulta-${c.id.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
