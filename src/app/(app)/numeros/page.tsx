import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getNumeros } from './actions-v2'
import NumerosV2Client from './numeros-v2-client'
import VitrinaPlaceholder from '@/components/vitrina-placeholder'
import { getVitrinaCopy } from '@/lib/workspace/vitrina'

export default async function NumerosPage() {
  const { supabase, workspaceId, role } = await getWorkspace()

  // Modo vitrina: el workspace solo compró Valida. Números se muestra como vitrina
  // comercial de upsell a ONE — bypassa el guard de módulo business y el permiso
  // canViewNumbers (debe verse aunque business esté off o el rol no lo vería).
  const vitrina = await getVitrinaCopy(supabase, workspaceId)
  if (vitrina) {
    return <VitrinaPlaceholder title="Números" body={vitrina.numeros} />
  }

  const perms = getRolePermissions(role || '')
  if (!perms.canViewNumbers) {
    redirect('/negocios')
  }

  const data = await getNumeros()

  return <NumerosV2Client initialData={data} />
}
