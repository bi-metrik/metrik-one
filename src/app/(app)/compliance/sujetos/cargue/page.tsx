import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { puedeGestionarSujetos } from '@/lib/compliance/sujetos';
import CargueSujetosClient from './cargue-client';

export const dynamic = 'force-dynamic';

export default async function CargueSujetosPage() {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) redirect('/');

  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  if (!modules.compliance || !modules.compliance_dual_informa) redirect('/');

  // El cargue da de alta y CIERRA relaciones en lote, y un cierre saca a la
  // contraparte del monitoreo. Es la misma llave que edita la ficha, no la de
  // solo ver la base: quien únicamente consulta no puede llegar por la URL.
  if (!puedeGestionarSujetos(role)) redirect('/compliance/sujetos');

  return <CargueSujetosClient />;
}
