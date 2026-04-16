import { notFound, redirect } from 'next/navigation'
import { getRiesgo, getControlesRiesgo, getEquipoParaRiesgo } from '@/lib/actions/riesgos'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import RiesgoDetail from './riesgo-detail'

export default async function RiesgoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { supabase, role } = await getWorkspace()
  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canViewRiesgos) redirect('/')

  const [riesgo, controles, equipo, causasRes, controlesFullRes] = await Promise.all([
    getRiesgo(id),
    getControlesRiesgo(id),
    getEquipoParaRiesgo(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('riesgo_causas')
      .select('*').eq('riesgo_id', id).order('referencia'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('riesgos_controles')
      .select('*').eq('riesgo_id', id).order('referencia'),
  ])

  if (!riesgo) notFound()

  return (
    <RiesgoDetail
      riesgo={riesgo}
      controles={controles}
      equipo={equipo}
      causas={causasRes.data || []}
      controlesFull={controlesFullRes.data || []}
      canEdit={perms.canEditRiesgos}
      canDelete={perms.canDeleteRiesgos}
    />
  )
}
