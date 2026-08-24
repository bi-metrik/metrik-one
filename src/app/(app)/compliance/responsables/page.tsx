import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { listarTableroResponsables } from '@/lib/actions/compliance-responsables';
import { puedeGestionarResponsables } from '@/lib/compliance/responsables';
import ResponsablesClient from './responsables-client';

export const dynamic = 'force-dynamic';

export default async function ResponsablesPage() {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) redirect('/');

  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  // Cuelga del módulo de riesgos y controles, no del dual de listas: un
  // workspace puede tener matriz de riesgo sin consultar listas restrictivas.
  if (!modules.compliance) redirect('/');

  // Ocultar el item del menú no impide teclear la URL: el guard va aquí. Y esta
  // pantalla no es "configuración" — lista nombres y documentos de identidad de
  // los responsables, que no tiene por qué circular por el workspace.
  if (!puedeGestionarResponsables(role)) redirect('/controles');

  const tablero = await listarTableroResponsables();
  if (!tablero.ok) {
    return (
      <div className="p-6 text-sm text-red-700">
        Error cargando los responsables: {tablero.error}
      </div>
    );
  }

  return <ResponsablesClient inicial={tablero.data} />;
}
