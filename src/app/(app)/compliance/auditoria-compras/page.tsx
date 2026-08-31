import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { puedeLiberarContrapartes } from '@/lib/compliance/liberaciones';
import AuditoriaComprasClient from './auditoria-compras-client';

export const dynamic = 'force-dynamic';

export default async function AuditoriaComprasPage() {
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

  // Ocultar el item del menú no impide teclear la URL: el guard va aquí. El
  // informe nombra a quién compró y a quién liberó, así que es del oficial.
  if (!puedeLiberarContrapartes(role)) redirect('/compliance/listas');

  return <AuditoriaComprasClient />;
}
