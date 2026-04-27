import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { listEtapas } from './actions'
import ProcesoClient from './proceso-client'

export default async function AdminProcesoPage() {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) redirect('/numeros')

  const etapas = await listEtapas('clarity')
  const totalListo = etapas.filter(e => e.skill_estado === 'listo').length

  return (
    <div className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[#1A1A1A]">Proceso Clarity</h1>
        <p className="mt-1 text-sm text-gray-500">
          Mapa del proceso interno MéTRIK. Cada etapa define inputs, outputs, gates y bloques del skill asociado.
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
          <span className="rounded-md border border-gray-200 bg-white px-2.5 py-1">
            {etapas.length} etapas
          </span>
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-700">
            {totalListo} skills listos
          </span>
          <span className="rounded-md border border-gray-200 bg-white px-2.5 py-1">
            {etapas.filter(e => e.skill_estado === 'pendiente').length} pendientes
          </span>
        </div>
      </header>

      {etapas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
          <p className="text-sm text-gray-600">No hay etapas definidas.</p>
          <p className="mt-2 text-xs text-gray-400">
            Aplica la migración <code className="rounded bg-white px-1 font-mono">20260427000001_admin_proceso_etapas.sql</code>
          </p>
        </div>
      ) : (
        <ProcesoClient etapas={etapas} />
      )}
    </div>
  )
}
