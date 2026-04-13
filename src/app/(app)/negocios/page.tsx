import Link from 'next/link'
import { Plus } from 'lucide-react'
import { getNegociosV2, getWorkspaceStagesActivos } from './negocio-v2-actions'
import NegociosClient from './negocios-client'

export default async function NegociosPage() {
  const [abiertos, cerrados, stagesActivos] = await Promise.all([
    getNegociosV2('abierto'),
    getNegociosV2('completado'),
    getWorkspaceStagesActivos(),
  ])
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Negocios</h1>
          <p className="text-xs text-muted-foreground">
            {abiertos.length} abierto{abiertos.length !== 1 ? 's' : ''}
            {cerrados.length > 0 && ` · ${cerrados.length} cerrado${cerrados.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <Link
          href="/negocios/nuevo"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Nuevo negocio
        </Link>
      </div>
      <NegociosClient negocios={abiertos} cerrados={cerrados} stagesActivos={stagesActivos} />
    </div>
  )
}
