import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { listarConsultasValida } from '@/lib/actions/valida-consultas';
import { getTutorialProgress } from '@/lib/actions/tutorial-progress';
import ValidaClient from './valida-client';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ negocio_id?: string }>;
}

export default async function ValidaPage({ searchParams }: Props) {
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

  const { negocio_id: negocioId } = await searchParams;

  // Resolver negocio si viene en query (para preset del filtro)
  let negocioInicial: { id: string; codigo: string; nombre: string; estado: string } | null = null;
  if (negocioId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: neg } = await (svc.from('negocios') as any)
      .select('id, codigo, nombre, estado')
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)
      .single();
    if (neg) negocioInicial = neg;
  }

  const historial = await listarConsultasValida({
    limite: 100,
    ...(negocioInicial ? { negocio_id: negocioInicial.id } : {}),
  });
  const tutorialProgress = await getTutorialProgress('valida_standalone');

  return (
    <ValidaClient
      historialInicial={historial.ok ? historial.consultas : []}
      errorHistorial={historial.ok ? null : historial.error}
      tutorialNuncaVisto={tutorialProgress === null}
      negocioInicial={negocioInicial}
    />
  );
}
