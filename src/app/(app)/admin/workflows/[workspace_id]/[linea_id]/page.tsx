import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getAdminFlujoDetalle } from '../../actions'
import FlujoDetalleClient from './flujo-detalle-client'

export default async function AdminFlujoDetallePage({
  params,
}: {
  params: Promise<{ workspace_id: string; linea_id: string }>
}) {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) {
    redirect('/numeros')
  }

  const { workspace_id, linea_id } = await params
  const detalle = await getAdminFlujoDetalle(workspace_id, linea_id)
  if (!detalle) notFound()

  return (
    <div className="mx-auto max-w-7xl p-4">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Link href="/admin/workflows" className="text-xs text-[#6B7280] hover:text-[#1A1A1A]">
            ← Workflows
          </Link>
          <h1 className="mt-1 text-xl font-bold text-[#1A1A1A]">
            {detalle.workspace.name ?? detalle.workspace.slug ?? '—'}
            <span className="mx-2 text-[#6B7280]">/</span>
            <span className="font-semibold">{detalle.linea.nombre}</span>
          </h1>
          <p className="text-[11px] text-[#6B7280]">
            {detalle.workspace.slug} · tipo: {detalle.linea.tipo} · {detalle.etapas.length} etapa{detalle.etapas.length === 1 ? '' : 's'}
            {!detalle.linea.is_active && <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500">línea inactiva</span>}
          </p>
        </div>
      </header>

      <FlujoDetalleClient detalle={detalle} />
    </div>
  )
}
