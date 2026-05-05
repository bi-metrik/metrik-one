import { ListChecks } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
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

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ListChecks className="h-6 w-6 text-[#1A1A1A]" />
        <div>
          <h1 className="text-xl font-bold text-[#1A1A1A]">Consulta de Listas Restrictivas</h1>
          <p className="text-sm text-[#6B7280]">
            Consulta puntual o masiva contra listas vinculantes y de referencia.
          </p>
        </div>
      </div>

      <ListasClient />
    </div>
  );
}
