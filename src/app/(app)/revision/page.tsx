import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getRevisionData } from './actions'
import { FiscalDisclaimer } from '@/components/fiscal-disclaimer'
import RevisionClient from './revision-client'

interface Props {
  searchParams: Promise<{ mes?: string; filtro?: string }>
}

export default async function RevisionPage({ searchParams }: Props) {
  const { role } = await getWorkspace()
  const perms = getRolePermissions(role || '')
  if (!perms.canViewRevision) redirect('/negocios')

  const params = await searchParams
  const mes = params.mes ?? new Date().toISOString().slice(0, 7)
  const filtro = (params.filtro as 'todos' | 'pendientes' | 'revisados') ?? 'todos'

  const { items, counts } = await getRevisionData(mes)

  // Apply client-side filter (server already orders pendientes first)
  const itemsFiltrados = filtro === 'pendientes'
    ? items.filter(i => !i.revisado)
    : filtro === 'revisados'
      ? items.filter(i => i.revisado)
      : items

  return (
    <>
      <div className="mx-auto max-w-3xl px-4 pt-6">
        <FiscalDisclaimer />
      </div>
      <RevisionClient
        items={itemsFiltrados}
        counts={counts}
        mes={mes}
        filtro={filtro}
        role={role ?? 'read_only'}
      />
    </>
  )
}
