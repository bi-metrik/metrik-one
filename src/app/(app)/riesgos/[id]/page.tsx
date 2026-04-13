import { notFound, redirect } from 'next/navigation'
import { getRiesgo, getControlesRiesgo, getEquipoParaRiesgo } from '@/lib/actions/riesgos'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import RiesgoDetail from './riesgo-detail'

export default async function RiesgoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { role } = await getWorkspace()
  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canViewRiesgos) redirect('/')

  const [riesgo, controles, equipo] = await Promise.all([
    getRiesgo(id),
    getControlesRiesgo(id),
    getEquipoParaRiesgo(),
  ])

  if (!riesgo) notFound()

  return (
    <RiesgoDetail
      riesgo={riesgo}
      controles={controles}
      equipo={equipo}
      canEdit={perms.canEditRiesgos}
      canDelete={perms.canDeleteRiesgos}
    />
  )
}
