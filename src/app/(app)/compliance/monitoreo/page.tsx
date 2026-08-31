import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { puedeLiberarContrapartes } from '@/lib/compliance/liberaciones';
import { estadoMonitoreo } from '@/lib/actions/compliance-monitoreo';
import MonitoreoClient from './monitoreo-client';

export const dynamic = 'force-dynamic';

export default async function MonitoreoPage() {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) redirect('/');

  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  if (!((wsRow?.modules ?? {}) as Record<string, boolean>).compliance_dual_informa) redirect('/');

  // El tope de consumo y el horizonte de rechazadas los fija el oficial.
  if (!puedeLiberarContrapartes(role)) redirect('/compliance/listas');

  const estado = await estadoMonitoreo();
  if (!estado.ok) {
    return <div className="p-6 text-sm text-red-700">Error cargando el motor: {estado.error}</div>;
  }

  return <MonitoreoClient inicial={estado.data} />;
}
