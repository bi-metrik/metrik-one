import { redirect } from 'next/navigation'
import { getCausasParaControlSelector, getEquipoParaRiesgo } from '@/lib/actions/riesgos'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import NuevoControlForm from './nuevo-control-form'

export default async function NuevoControlPage() {
  const { role } = await getWorkspace()
  if (!getRolePermissions(role ?? 'read_only').canEditRiesgos) redirect('/controles')

  const [causas, equipo] = await Promise.all([
    getCausasParaControlSelector(),
    getEquipoParaRiesgo(),
  ])

  return <NuevoControlForm causas={causas} equipo={equipo} />
}
