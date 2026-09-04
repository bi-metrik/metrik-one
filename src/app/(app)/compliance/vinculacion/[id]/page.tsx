import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { puedeVerVinculacion } from '@/lib/compliance/vinculacion';
import { detalleVinculacion } from '@/lib/actions/compliance-vinculacion';
import DetalleClient from './detalle-client';

export const dynamic = 'force-dynamic';

export default async function DetalleVinculacionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) redirect('/');

  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  if (!modules.compliance || !modules.compliance_vinculacion) redirect('/');
  if (!puedeVerVinculacion(role)) redirect('/');

  const r = await detalleVinculacion(id);

  if (!r.ok) {
    return (
      <div className="p-6 max-w-3xl">
        <Link
          href="/compliance/vinculacion"
          className="inline-flex items-center gap-1 text-sm text-[#6B7280] hover:text-[#1A1A1A] mb-4"
        >
          <ChevronLeft className="w-4 h-4" /> Volver a la bandeja
        </Link>
        <div className="rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/5 p-4 text-sm text-[#B91C1C]">
          <p className="font-semibold">No se pudo abrir el expediente.</p>
          <p className="mt-1">{r.error}</p>
        </div>
      </div>
    );
  }

  return <DetalleClient inicial={r.data} />;
}
