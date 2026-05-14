import { redirect } from 'next/navigation';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { getSegmentacionConfig } from '@/lib/actions/valida-segmentacion';
import { getDistribucionSegmentacion } from '@/lib/actions/valida-score';
import SegmentacionClient from './segmentacion-client';

export const dynamic = 'force-dynamic';

export default async function SegmentacionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any;
  const { data: profile } = await svc
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single();

  if (!profile?.workspace_id) redirect('/onboarding');

  const { data: ws } = await svc
    .from('workspaces')
    .select('modules')
    .eq('id', profile.workspace_id)
    .single();

  const modules = (ws?.modules as Record<string, boolean>) ?? {};
  if (!modules.valida_consulta) {
    redirect('/valida');
  }

  // Solo owner/admin/supervisor pueden configurar segmentación
  if (!['owner', 'admin', 'supervisor'].includes(profile.role)) {
    redirect('/valida');
  }

  const r = await getSegmentacionConfig();
  if (!r.ok) {
    return (
      <div className="p-6 text-sm text-red-700">Error: {r.error}</div>
    );
  }

  const dist = await getDistribucionSegmentacion();

  return (
    <SegmentacionClient
      configInicial={r.config}
      distribucionInicial={dist.ok ? dist.distribucion : null}
    />
  );
}
