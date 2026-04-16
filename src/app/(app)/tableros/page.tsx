import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getComercialData, getOperativoData, getFinancieroData } from './actions'
import TablerosClient from './tableros-client'

export default async function TablerosPage() {
  const { supabase, workspaceId, role } = await getWorkspace()
  const perms = getRolePermissions(role || '')
  if (!perms.canViewNumbers) {
    redirect('/negocios')
  }

  // Load workspace modules
  let modules: Record<string, boolean> = { business: true }
  if (workspaceId && supabase) {
    const { data: ws } = await (supabase.from('workspaces') as any)
      .select('modules')
      .eq('id', workspaceId)
      .single()
    modules = (ws?.modules as Record<string, boolean> | null) ?? { business: true }
  }

  // Only fetch business data if business module is active
  const [comercial, operativo, financiero] = modules.business
    ? await Promise.all([
        getComercialData('mes'),
        getOperativoData('mes'),
        getFinancieroData('6meses'),
      ])
    : [null, null, null]

  return (
    <TablerosClient
      initialComercial={comercial}
      initialOperativo={operativo}
      initialFinanciero={financiero}
      modules={modules}
    />
  )
}
