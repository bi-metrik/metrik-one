import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { listarConsultas } from '@/lib/actions/valida';
import { getTutorialProgress } from '@/lib/actions/tutorial-progress';
import ValidacionClient from './validacion-client';

export default async function ValidacionPage() {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) redirect('/');

  // Los mismos cortes que el menú (`app-shell.tsx`), que solo esconde. El
  // historial sale de la llave GLOBAL de MeTRIK y trae consultas de todos los
  // espacios que la usan: abierto por URL, un operador de un espacio con la
  // consulta dual veía nombres y documentos consultados por otros clientes.
  if (!['owner', 'admin', 'supervisor', 'read_only'].includes(role ?? '')) redirect('/');
  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  if (modules.compliance_dual_informa) redirect('/compliance/listas');

  const historial = await listarConsultas({ limite: 50 });
  const tutorialProgress = await getTutorialProgress('valida_compliance');

  return (
    <ValidacionClient
      historial={historial.ok ? historial.consultas : []}
      errorHistorial={historial.ok ? null : historial.error}
      tutorialNuncaVisto={tutorialProgress === null}
    />
  );
}
