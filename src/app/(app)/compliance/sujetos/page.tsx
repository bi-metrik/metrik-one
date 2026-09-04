import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { puedeVerSujetos } from '@/lib/compliance/sujetos';
import {
  listarSegmentosParaSujetos,
  listarSujetos,
} from '@/lib/actions/compliance-sujetos';
import SujetosClient from './sujetos-client';

export const dynamic = 'force-dynamic';

export default async function SujetosPage() {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) redirect('/');

  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  // El estado de cada sujeto se deriva de las consultas a listas: sin el dual
  // activo la pantalla mostraria a todo el mundo como "sin consultar" para
  // siempre, que es peor que no tenerla.
  if (!modules.compliance || !modules.compliance_dual_informa) redirect('/');

  // A diferencia del expediente y de las liberaciones, esta pantalla SÍ es del
  // ejecutor: es donde ve a quién tiene vinculado y si puede contratarlo.
  if (!puedeVerSujetos(role)) redirect('/controles');

  const [base, segmentos] = await Promise.all([
    listarSujetos(),
    listarSegmentosParaSujetos(),
  ]);

  if (!base.ok) {
    return <div className="p-6 text-sm text-red-700">Error cargando la base: {base.error}</div>;
  }

  return (
    <SujetosClient
      inicial={base.data}
      segmentos={segmentos.ok ? segmentos.data : []}
      rol={role ?? ''}
    />
  );
}
