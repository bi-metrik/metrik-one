import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { puedeVerVinculacion } from '@/lib/compliance/vinculacion';
import { listarVinculaciones } from '@/lib/actions/compliance-vinculacion';
import VinculacionClient from './vinculacion-client';

export const dynamic = 'force-dynamic';

export default async function VinculacionPage() {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) redirect('/');

  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  // Add-on con costo variable por expediente: no se enciende solo por tener
  // compliance. Ver `compliance_vinculacion` en los módulos del workspace.
  if (!modules.compliance || !modules.compliance_vinculacion) redirect('/');

  // Misma restricción que Liberaciones, y por la misma razón: el expediente
  // trae cédulas, declaración de renta y la cadena de beneficiarios finales.
  if (!puedeVerVinculacion(role)) redirect('/');

  const bandeja = await listarVinculaciones();

  return <VinculacionClient inicial={bandeja.ok ? bandeja.data : null} error={bandeja.ok ? null : bandeja.error} />;
}
