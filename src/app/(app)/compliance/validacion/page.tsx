import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { listarConsultas } from '@/lib/actions/valida';
import { getTutorialProgress } from '@/lib/actions/tutorial-progress';
import ValidacionClient from './validacion-client';

export default async function ValidacionPage() {
  const { workspaceId } = await getWorkspace();
  if (!workspaceId) redirect('/');

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
