import { redirect, notFound } from 'next/navigation'
import { getControl } from '@/lib/actions/riesgos'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import ControlDetailClient from './control-detail-client'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ControlDetailPage({ params }: Props) {
  const { id } = await params
  const { role } = await getWorkspace()
  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canViewRiesgos) redirect('/')

  const result = await getControl(id)
  if (!result) notFound()

  return <ControlDetailClient control={result.control} causas={result.causas} />
}
