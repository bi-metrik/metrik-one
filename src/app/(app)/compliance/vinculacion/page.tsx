import { redirect } from 'next/navigation';
import { getWorkspace } from '@/lib/actions/get-workspace';
import { createServiceClient } from '@/lib/supabase/server';
import { puedeDecidirVinculacion, puedeVerVinculacion } from '@/lib/compliance/vinculacion';
import { enlaceDeSolicitud, listarVinculaciones } from '@/lib/actions/compliance-vinculacion';
import VinculacionClient from './vinculacion-client';

export const dynamic = 'force-dynamic';

export default async function VinculacionPage() {
  const { workspaceId, role } = await getWorkspace();
  if (!workspaceId) redirect('/');

  const svc = createServiceClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wsRow } = await (svc.from('workspaces') as any)
    .select('modules, name')
    .eq('id', workspaceId)
    .single();
  const modules = (wsRow?.modules ?? {}) as Record<string, boolean>;
  // El nombre va al mensaje que el oficial copia y le manda al proveedor: sin él
  // el proveedor recibe un enlace sin remitente pidiéndole documentos.
  const empresa = ((wsRow?.name as string | null) ?? '').trim() || 'nuestra empresa';
  // Add-on con costo variable por expediente: no se enciende solo por tener
  // compliance. Ver `compliance_vinculacion` en los módulos del workspace.
  if (!modules.compliance || !modules.compliance_vinculacion) redirect('/');

  // Misma restricción que Liberaciones, y por la misma razón: el expediente
  // trae cédulas, declaración de renta y la cadena de beneficiarios finales.
  if (!puedeVerVinculacion(role)) redirect('/');

  // El enlace de solicitud se pide aparte: si Valida no lo devuelve, la bandeja
  // igual tiene que cargar. Son dos cosas distintas y una caída no puede
  // esconder la otra.
  const [bandeja, enlace] = await Promise.all([listarVinculaciones(), enlaceDeSolicitud()]);

  return (
    <VinculacionClient
      inicial={bandeja.ok ? bandeja.data : null}
      error={bandeja.ok ? null : bandeja.error}
      enlace={enlace.ok ? enlace.data : null}
      errorEnlace={enlace.ok ? null : enlace.error}
      puedeRotar={puedeDecidirVinculacion(role)}
      empresa={empresa}
    />
  );
}
