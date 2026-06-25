import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getNumeros } from './actions-v2'
import NumerosV2Client from './numeros-v2-client'
import { isModoVitrina } from '@/lib/workspace/vitrina'

export default async function NumerosPage() {
  const { supabase, workspaceId, role } = await getWorkspace()

  // Modo vitrina: el workspace solo compró Valida. Números se muestra como MUESTRA
  // EN CEROS del dashboard real (Maxitec no tiene operación → todo en cero) con un
  // banner comercial de upsell. Bypassa el guard de módulo business y el permiso
  // canViewNumbers (debe verse aunque business esté off o el rol no lo vería).
  const modoVitrina = await isModoVitrina(supabase, workspaceId)
  if (modoVitrina) {
    const data = await getNumeros()
    return <NumerosV2Client initialData={data} modoVitrina />
  }

  const perms = getRolePermissions(role || '')
  if (!perms.canViewNumbers) {
    redirect('/negocios')
  }

  const data = await getNumeros()

  return <NumerosV2Client initialData={data} />
}
