import { redirect } from 'next/navigation'
import { getRiesgosParaSelector } from '@/lib/actions/riesgos'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import NuevaCausaForm from './nueva-causa-form'

export default async function NuevaCausaPage() {
  const { role } = await getWorkspace()
  if (!getRolePermissions(role ?? 'read_only').canEditRiesgos) {
    redirect('/riesgos')
  }

  const riesgos = await getRiesgosParaSelector()

  return <NuevaCausaForm riesgos={riesgos} />
}
