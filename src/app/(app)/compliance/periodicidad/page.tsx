import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { puedeLiberarContrapartes } from '@/lib/compliance/liberaciones';
import { listarPeriodicidad } from '@/lib/actions/compliance-periodicidad';
import PeriodicidadClient from './periodicidad-client';

export const dynamic = 'force-dynamic';

export default async function PeriodicidadPage() {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) redirect('/');

  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  if (!((wsRow?.modules ?? {}) as Record<string, boolean>).compliance_dual_informa) redirect('/');

  // Es configuración de la política de riesgo del obligado: la fija el oficial
  // de cumplimiento, no quien consulta.
  if (!puedeLiberarContrapartes(role)) redirect('/compliance/listas');

  const filas = await listarPeriodicidad();
  if (!filas.ok) {
    return <div className="p-6 text-sm text-red-700">Error cargando la configuración: {filas.error}</div>;
  }

  return <PeriodicidadClient inicial={filas.data} />;
}
