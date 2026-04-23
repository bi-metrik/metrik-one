import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { listWorkflows } from './actions'
import WorkflowsFilters from './workflows-filters'

export default async function AdminWorkflowsPage() {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) redirect('/numeros')

  const workflows = await listWorkflows()
  const allTags = Array.from(new Set(workflows.flatMap(w => w.tags ?? []))).sort()
  const allLineas = Array.from(new Set(workflows.map(w => w.linea_negocio))).sort()
  const clientes = Array.from(new Set(workflows.map(w => w.cliente_slug))).sort()

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Workflows</h1>
        <p className="mt-1 text-sm text-gray-500">
          Biblioteca consolidada de flujos de procesos de MéTRIK. Solo visualizacion — para generar PDF usa el skill <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs">/workflow</code> local.
        </p>
        <div className="mt-3 flex gap-3 text-xs text-gray-500">
          <span className="rounded-md border border-gray-200 bg-white px-2.5 py-1">
            {workflows.length} workflows
          </span>
          <span className="rounded-md border border-gray-200 bg-white px-2.5 py-1">
            {clientes.length} clientes
          </span>
          <span className="rounded-md border border-gray-200 bg-white px-2.5 py-1">
            {allLineas.length} lineas de negocio
          </span>
        </div>
      </header>

      {workflows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <p className="text-sm text-gray-600">No hay workflows publicados todavia.</p>
          <p className="mt-2 text-xs text-gray-400">
            Publica desde el skill <code className="rounded bg-white px-1 py-0.5 font-mono">/workflow</code> ejecutando <code className="rounded bg-white px-1 py-0.5 font-mono">sync_to_one.js</code>.
          </p>
        </div>
      ) : (
        <WorkflowsFilters workflows={workflows} tags={allTags} />
      )}
    </div>
  )
}
