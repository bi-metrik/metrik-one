import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { listarSegmentos } from '@/lib/actions/compliance-segmentos';
import { puedeConfigurarSegmentos } from '@/lib/compliance/segmentos';
import SegmentosClient from './segmentos-client';

export const dynamic = 'force-dynamic';

export default async function CatalogoSegmentosPage() {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) redirect('/');

  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  if (!modules.compliance_dual_informa) redirect('/');

  // Ocultar el item del menu no impide teclear la URL: el guard va aqui.
  if (!puedeConfigurarSegmentos(role)) redirect('/compliance/listas');

  const r = await listarSegmentos({ incluirInactivos: true });
  if (!r.ok) {
    return <div className="p-6 text-sm text-red-700">Error cargando el catálogo: {r.error}</div>;
  }

  return <SegmentosClient inicial={r.data} />;
}
