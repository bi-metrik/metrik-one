import { ShieldCheck } from 'lucide-react';
import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { listarConsultas } from '@/lib/actions/valida';
import ValidacionClient from './validacion-client';

export default async function ValidacionPage() {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) redirect('/');

  const historial = await listarConsultas({ limite: 50 });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-[#10B981]" />
        <div>
          <h1 className="text-xl font-bold text-[#1A1A1A]">Validacion SARLAFT</h1>
          <p className="text-sm text-[#6B7280]">
            Consulta contra ONU + CSN Colombia + PEP + OFAC + UE via Valida
          </p>
        </div>
      </div>

      <ValidacionClient
        historial={historial.ok ? historial.consultas : []}
        errorHistorial={historial.ok ? null : historial.error}
      />
    </div>
  );
}
