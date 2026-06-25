import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getComercialData, getOperativoData, getFinancieroData } from './actions'
import TablerosClient from './tableros-client'
import VitrinaPlaceholder from '@/components/vitrina-placeholder'
import { getVitrinaCopy } from '@/lib/workspace/vitrina'

export default async function TablerosPage() {
  const { supabase, workspaceId, role } = await getWorkspace()

  // Modo vitrina: el workspace solo compró Valida. Tableros se muestra como vitrina
  // comercial de upsell a ONE — bypassa el guard de permiso canViewNumbers.
  const vitrina = await getVitrinaCopy(supabase, workspaceId)
  if (vitrina) {
    return <VitrinaPlaceholder title="Tableros" body={vitrina.tableros} />
  }

  const perms = getRolePermissions(role || '')
  if (!perms.canViewNumbers) {
    redirect('/negocios')
  }

  // Load workspace modules
  let modules: Record<string, boolean> = { business: true }
  if (workspaceId && supabase) {
    const { data: ws } = await supabase
      .from('workspaces')
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
