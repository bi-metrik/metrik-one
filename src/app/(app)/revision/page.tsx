import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getRevisionData } from './actions'

interface Props {
  searchParams: Promise<{ mes?: string }>
}

export default async function RevisionPage({ searchParams }: Props) {
  const { role } = await getWorkspace()
  const perms = getRolePermissions(role || '')
  if (!perms.canViewRevision) redirect('/negocios')

  const params = await searchParams
  const mes = params.mes ?? new Date().toISOString().slice(0, 7)
  const { items, counts } = await getRevisionData(mes)

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-2">Bandeja de revision</h1>
      <p className="text-sm text-zinc-600 mb-4">
        {counts.pendientes} pendientes · {counts.revisados} revisados · mes {mes}
      </p>
      <p className="text-xs text-zinc-500 italic">
        Vista completa pendiente de implementacion (Fase B).
        Items cargados: {items.length}.
      </p>
    </div>
  )
}
