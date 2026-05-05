import { Scale } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import ComparativaClient from './comparativa-client';

export const dynamic = 'force-dynamic';

export default async function ComparativaInformaPage() {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) redirect('/');

  // Solo workspace metrik puede acceder
  const svc = createServiceClient();
  const { data: ws } = await svc
    .from('workspaces')
    .select('slug')
    .eq('id', workspaceId)
    .single();
  if (ws?.slug !== 'metrik') redirect('/');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  if (!modules.compliance_audit) redirect('/');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Scale className="h-6 w-6 text-[#10B981]" />
        <div>
          <h1 className="text-xl font-bold text-[#1A1A1A]">Comparativa Informa vs Valida</h1>
          <p className="text-sm text-[#6B7280]">
            Auditoría de consultas duales — workspace MéTRIK.
          </p>
        </div>
      </div>

      <ComparativaClient />
    </div>
  );
}
