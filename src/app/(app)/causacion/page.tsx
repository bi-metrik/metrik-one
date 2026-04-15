import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getCausacionData } from './actions'
import CausacionClient from './causacion-client'

interface Props {
  searchParams: Promise<{ tab?: string; mes?: string }>
}

export default async function CausacionPage({ searchParams }: Props) {
  const { role } = await getWorkspace()
  const perms = getRolePermissions(role || '')
  if (!perms.canViewCausacion) redirect('/negocios')

  const params = await searchParams
  const tab = (params.tab as 'aprobados' | 'causados') ?? 'aprobados'
  const mes = params.mes ?? new Date().toISOString().slice(0, 7)

  const { items, counts, totales } = await getCausacionData(tab, mes)

  return (
    <CausacionClient
      items={items}
      counts={counts}
      activeTab={tab}
      mes={mes}
      role={role ?? undefined}
      totales={totales}
    />
  )
}
