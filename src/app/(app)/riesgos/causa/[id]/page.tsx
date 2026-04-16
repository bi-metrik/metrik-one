import { notFound, redirect } from 'next/navigation'
import { getCausa } from '@/lib/actions/riesgos'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import CausaDetailClient from './causa-detail-client'

export default async function CausaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const { role } = await getWorkspace()
  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canViewRiesgos) redirect('/')

  const result = await getCausa(id)
  if (!result) notFound()

  const { causa, riesgo, controles } = result

  return (
    <CausaDetailClient
      causaId={id}
      causa={causa}
      riesgo={riesgo}
      controles={controles}
      canEdit={perms.canEditRiesgos}
    />
  )
}
