import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import {
  listarTableroLiberaciones,
  listarControlesParaLiberacion,
} from '@/lib/actions/compliance-liberaciones';
import { puedeLiberarContrapartes } from '@/lib/compliance/liberaciones';
import { coberturaDelCatalogo } from '@/lib/actions/compliance-tier-catalogo';
import LiberacionesClient from './liberaciones-client';

export const dynamic = 'force-dynamic';

export default async function LiberacionesPage() {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) redirect('/');

  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  if (!modules.compliance_dual_informa) redirect('/');

  // Ocultar el item del menú no impide teclear la URL: el guard va aquí. Y esta
  // pantalla no es "configuración" — muestra quién quedó reportado en listas
  // restrictivas, que es justo lo que no debe circular por el workspace.
  if (!puedeLiberarContrapartes(role)) redirect('/compliance/listas');

  // Ventana del indicador de cobertura del catálogo (C5 del concepto de Emilio):
  // los últimos 90 días. Es una lectura de calidad del catálogo, no del riesgo
  // de una contraparte, y por eso no sigue el periodo que el oficial audita.
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [tablero, controles, cobertura] = await Promise.all([
    listarTableroLiberaciones(),
    listarControlesParaLiberacion(),
    coberturaDelCatalogo(desde.toISOString(), hasta.toISOString()),
  ]);

  if (!tablero.ok) {
    return <div className="p-6 text-sm text-red-700">Error cargando las contrapartes: {tablero.error}</div>;
  }

  return (
    <LiberacionesClient
      inicial={tablero.data}
      controles={controles.ok ? controles.data : []}
      cobertura={cobertura}
    />
  );
}
