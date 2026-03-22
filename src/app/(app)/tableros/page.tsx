import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getComercialData, getOperativoData, getFinancieroData } from './actions'
import TablerosClient from './tableros-client'

export default async function TablerosPage() {
  const { role } = await getWorkspace()
  const perms = getRolePermissions(role || '')
  if (!perms.canViewNumbers) {
    redirect('/pipeline')
  }

  // Parallel fetch all 3 tabs
  const [comercial, operativo, financiero] = await Promise.all([
    getComercialData('mes'),
    getOperativoData('mes'),
    getFinancieroData('6meses'),
  ])

  return (
    <TablerosClient
      initialComercial={comercial}
      initialOperativo={operativo}
      initialFinanciero={financiero}
    />
  )
}
