import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { getTutorialProgress } from '@/lib/actions/tutorial-progress';
import ListasClient from './listas-client';

export const dynamic = 'force-dynamic';

export default async function ListasRestrictivasPage() {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) redirect('/');

  // Validar que el workspace tiene el flag activo
  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  if (!modules.compliance_dual_informa) redirect('/');

  const tutorialProgress = await getTutorialProgress('compliance_listas_dual');

  return <ListasClient tutorialNuncaVisto={tutorialProgress === null} />;
}
