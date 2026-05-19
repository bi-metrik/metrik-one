import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getFlujoData } from './actions'
import FlujoClient from './flujo-client'

export default async function FlujoPage({
  searchParams,
}: {
  searchParams: Promise<{ linea?: string }>
}) {
  const { workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId || !role) redirect('/login')

  const perms = getRolePermissions(role)
  if (!perms.canViewFlujo) redirect('/numeros')

  const sp = await searchParams
  const data = await getFlujoData(sp.linea ?? null)

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      <FlujoClient data={data} />
    </div>
  )
}
