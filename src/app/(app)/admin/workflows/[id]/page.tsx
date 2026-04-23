import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getWorkflow } from '../actions'
import WorkflowDetailClient from './workflow-detail-client'
import CatalogoSidebar from './catalogo-sidebar'
import Convenciones from './convenciones'

export default async function WorkflowDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) redirect('/numeros')

  const { id } = await params
  const wf = await getWorkflow(id)
  if (!wf) notFound()

  const htmlUrl = `/api/admin/workflows/html/${id}`
  const identificador = wf.numero_flujo
    ? `${wf.cliente_slug}${wf.numero_flujo}`
    : wf.cliente_slug

  return (
    <div className="mx-auto max-w-[1600px] p-4">
      <header className="mb-3 flex items-center justify-between gap-4">
        <Link href="/admin/workflows" className="text-xs text-gray-400 hover:text-gray-600">
          ← Workflows
        </Link>
        <div className="text-[11px] text-gray-400">
          <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px]">{identificador}</code>
          <span className="mx-2">·</span>
          {wf.nombre_flujo}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr_280px]">
        {/* Panel izquierdo: convenciones + catalogo */}
        <aside className="space-y-3">
          <Convenciones />
          <CatalogoSidebar />
        </aside>

        {/* iframe con el HTML (solo el flujo) */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white" style={{ height: '82vh' }}>
          <iframe
            src={htmlUrl}
            sandbox="allow-scripts allow-same-origin"
            className="h-full w-full"
            title={wf.nombre_flujo}
          />
        </div>

        {/* Panel derecho: metadata + acciones */}
        <aside className="space-y-3">
          <WorkflowDetailClient workflow={wf} />
        </aside>
      </div>
    </div>
  )
}
