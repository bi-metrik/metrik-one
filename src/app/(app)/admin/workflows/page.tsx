import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { listAdminWorkflows } from './actions'
import WorkflowsList from './workflows-list'

export default async function AdminWorkflowsPage() {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) {
    redirect('/numeros')
  }

  const items = await listAdminWorkflows()
  const workspaces = Array.from(new Set(items.map(i => i.workspace_slug || i.workspace_id))).sort()

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-tinta">Workflows</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          Biblioteca de flujos en vivo desde la DB. Cada item es un workspace × línea con sus etapas y bloques actuales.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-tinta-suave">
          <span className="rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1">
            {items.length} flujos
          </span>
          <span className="rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1">
            {workspaces.length} workspaces
          </span>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-papel p-8 text-center">
          <p className="text-sm text-tinta-suave">No hay líneas de negocio configuradas en ningún workspace todavía.</p>
        </div>
      ) : (
        <WorkflowsList items={items} />
      )}
    </div>
  )
}
