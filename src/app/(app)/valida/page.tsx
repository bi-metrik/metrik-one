import { ShieldCheck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { listarConsultasValida } from '@/lib/actions/valida-consultas';
import ValidaClient from './valida-client';

export const dynamic = 'force-dynamic';

export default async function ValidaPage() {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) redirect('/');

  // Validar flag activo
  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  if (!modules.valida_consulta) redirect('/');

  const historial = await listarConsultasValida({ limite: 100 });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-[#10B981]" />
        <div>
          <h1 className="text-xl font-bold text-[#1A1A1A]">Valida</h1>
          <p className="text-sm text-[#6B7280]">
            Consulta puntual o masiva contra listas vinculantes SARLAFT (ONU, OFAC, UE, PEP, CSN).
          </p>
        </div>
      </div>

      <ValidaClient
        historialInicial={historial.ok ? historial.consultas : []}
        errorHistorial={historial.ok ? null : historial.error}
      />
    </div>
  );
}
