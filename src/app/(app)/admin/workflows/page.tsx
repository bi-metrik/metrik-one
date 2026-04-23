import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { listWorkflows } from './actions'
import WorkflowsFilters from './workflows-filters'

const LINEA_LABELS: Record<string, string> = {
  '20': '[20] Clarity',
  '21': '[21] ONE',
  '22': '[22] Analytics',
  '23': '[23] Projects',
  'interno': 'Interno',
}

export default async function AdminWorkflowsPage() {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) redirect('/numeros')

  const workflows = await listWorkflows()

  // Agrupar por cliente → proyecto → linea
  const grouped: Record<string, Record<string, Record<string, typeof workflows>>> = {}
  for (const wf of workflows) {
    const c = wf.cliente_slug
    const p = wf.proyecto_slug
    const l = wf.linea_negocio
    grouped[c] ??= {}
    grouped[c][p] ??= {}
    grouped[c][p][l] ??= []
    grouped[c][p][l].push(wf)
  }

  const clientes = Object.keys(grouped).sort()
  const allTags = Array.from(new Set(workflows.flatMap(w => w.tags ?? []))).sort()
  const allLineas = Array.from(new Set(workflows.map(w => w.linea_negocio))).sort()

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
        <WorkflowsFilters workflows={workflows} tags={allTags}>
          {(filtered) => {
            // Re-agrupar filtered
            const g: Record<string, Record<string, Record<string, typeof workflows>>> = {}
            for (const wf of filtered) {
              g[wf.cliente_slug] ??= {}
              g[wf.cliente_slug][wf.proyecto_slug] ??= {}
              g[wf.cliente_slug][wf.proyecto_slug][wf.linea_negocio] ??= []
              g[wf.cliente_slug][wf.proyecto_slug][wf.linea_negocio].push(wf)
            }
            const cs = Object.keys(g).sort()
            return (
              <div className="space-y-6">
                {cs.map(cliente => (
                  <section key={cliente} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <header className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
                      <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">
                        {filtered.find(w => w.cliente_slug === cliente)?.cliente_nombre || cliente}
                      </h2>
                      <p className="text-[11px] text-gray-400">slug: {cliente}</p>
                    </header>
                    <div className="divide-y divide-gray-100">
                      {Object.keys(g[cliente]).sort().map(proyecto => (
                        <div key={proyecto} className="px-4 py-3">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                            Proyecto: {proyecto}
                          </p>
                          <div className="space-y-2">
                            {Object.keys(g[cliente][proyecto]).sort().map(linea => (
                              <div key={linea}>
                                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                                  {LINEA_LABELS[linea] ?? linea}
                                </p>
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                  {g[cliente][proyecto][linea].map(wf => (
                                    <Link
                                      key={wf.id}
                                      href={`/admin/workflows/${wf.id}`}
                                      className="group rounded-lg border border-gray-200 bg-white p-3 transition hover:border-[#10B981] hover:shadow-sm"
                                    >
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                          <p className="truncate text-[13px] font-semibold text-[#1A1A1A] group-hover:text-[#10B981]">
                                            {wf.nombre_flujo}
                                          </p>
                                          <p className="text-[11px] text-gray-400">
                                            v{wf.version} · {wf.total_fases ?? '?'} fases · {wf.total_etapas ?? '?'} etapas
                                          </p>
                                        </div>
                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                                          wf.estado === 'vigente' ? 'bg-emerald-100 text-emerald-700' :
                                          wf.estado === 'listo_revision' ? 'bg-amber-100 text-amber-700' :
                                          wf.estado === 'archivado' ? 'bg-gray-200 text-gray-500' :
                                          'bg-blue-100 text-blue-700'
                                        }`}>
                                          {wf.estado.replace('_', ' ')}
                                        </span>
                                      </div>
                                      {wf.tags && wf.tags.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                          {wf.tags.slice(0, 4).map(t => (
                                            <span key={t} className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] text-gray-600">
                                              {t}
                                            </span>
                                          ))}
                                          {wf.tags.length > 4 && (
                                            <span className="text-[9px] text-gray-400">+{wf.tags.length - 4}</span>
                                          )}
                                        </div>
                                      )}
                                    </Link>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )
          }}
        </WorkflowsFilters>
      )}
    </div>
  )
}
