import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getNumeros } from './actions-v2'
import NumerosV2Client from './numeros-v2-client'

export default async function NumerosPage() {
  const { role } = await getWorkspace()
  const perms = getRolePermissions(role || '')
  if (!perms.canViewNumbers) {
    redirect('/negocios')
  }

  const data = await getNumeros()

  return <NumerosV2Client initialData={data} />
}
