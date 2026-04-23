import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getWorkflow } from '../actions'
import WorkflowDetailClient from './workflow-detail-client'

const LINEA_LABELS: Record<string, string> = {
  '20': '[20] Clarity',
  '21': '[21] ONE',
  '22': '[22] Analytics',
  '23': '[23] Projects',
  'interno': 'Interno',
}

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

  // Servimos el HTML via ruta local (content-type correcto garantizado).
  // Supabase signed URL devuelve text/plain para .html aunque el mime almacenado sea text/html.
  const htmlUrl = `/api/admin/workflows/html/${id}`

  return (
    <div className="mx-auto max-w-[1400px] p-4">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/admin/workflows" className="mb-1 inline-block text-xs text-gray-400 hover:text-gray-600">
            ← Workflows
          </Link>
          <h1 className="truncate text-xl font-bold text-[#1A1A1A]">{wf.nombre_flujo}</h1>
          <p className="text-xs text-gray-500">
            {wf.cliente_nombre || wf.cliente_slug} &middot; {wf.proyecto_slug} &middot; {LINEA_LABELS[wf.linea_negocio] ?? wf.linea_negocio}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        {/* iframe con el HTML */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white" style={{ height: '78vh' }}>
          <iframe
            src={htmlUrl}
            sandbox="allow-scripts allow-same-origin"
            className="h-full w-full"
            title={wf.nombre_flujo}
          />
        </div>

        {/* Panel lateral con metadata + acciones */}
        <aside className="space-y-4">
          <WorkflowDetailClient workflow={wf} />
        </aside>
      </div>
    </div>
  )
}
