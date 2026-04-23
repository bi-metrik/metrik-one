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
  const displayName = wf.linea_negocio_cliente
    ? `${identificador} - ${wf.linea_negocio_cliente}`
    : `${identificador} - ${wf.nombre_flujo}`

  return (
    <div className="mx-auto max-w-[1600px] p-4">
      <header className="mb-3 flex items-center justify-between gap-4">
        <Link href="/admin/workflows" className="text-xs text-gray-400 hover:text-gray-600">
          ← Workflows
        </Link>
        <div className="text-sm font-semibold text-[#1A1A1A]">
          {displayName}
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
            title={displayName}
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
