import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { puedeLiberarContrapartes } from '@/lib/compliance/liberaciones';
import {
  listarCargosParaDocumentos,
  listarExpediente,
} from '@/lib/actions/compliance-documentos';
import DocumentosClient from './documentos-client';

export const dynamic = 'force-dynamic';

export default async function DocumentosPage() {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) redirect('/');

  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  // Cuelga del módulo de compliance y no del dual de listas: el expediente de
  // gobierno existe aunque el workspace nunca consulte listas restrictivas.
  if (!modules.compliance) redirect('/');

  // Ocultar el item del menú no impide teclear la URL: el guard va aquí. Qué
  // piezas componen el expediente de la compañía lo declara el oficial de
  // cumplimiento, no quien opera.
  if (!puedeLiberarContrapartes(role)) redirect('/controles');

  const [expediente, cargos] = await Promise.all([
    listarExpediente(),
    listarCargosParaDocumentos(),
  ]);

  if (!expediente.ok) {
    return <div className="p-6 text-sm text-red-700">Error cargando el expediente: {expediente.error}</div>;
  }

  return (
    <DocumentosClient
      inicial={expediente.data}
      cargos={cargos.ok ? cargos.data : []}
    />
  );
}
