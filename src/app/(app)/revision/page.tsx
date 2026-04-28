import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getRevisionData } from './actions'
import { FiscalDisclaimer } from '@/components/fiscal-disclaimer'

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
    <div className="mx-auto max-w-4xl p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Bandeja de revision</h1>
        <p className="text-sm text-[#6B7280]">
          {counts.pendientes} pendientes · {counts.revisados} revisados · mes {mes}
        </p>
      </div>

      <FiscalDisclaimer />

      <p className="text-xs text-[#6B7280] italic">
        Vista completa pendiente de implementacion (Fase B.2).
        Items cargados: {items.length}.
      </p>
    </div>
  )
}
