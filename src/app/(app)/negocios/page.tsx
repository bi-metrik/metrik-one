import Link from 'next/link'
import { Plus } from 'lucide-react'
import {
  getNegociosV2,
  getWorkspaceStagesActivos,
  getEtapasSegmentador,
  getStaffParaAsignarNegocio,
} from './negocio-v2-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getAreasEfectivas, type Area, type Role } from '@/lib/permissions/can-edit'
import { getRolePermissions, puedeMarcarCondicionNegocio } from '@/lib/roles'
import NegociosClient from './negocios-client'

type StageFilter = 'todos' | 'venta' | 'ejecucion' | 'cobro'

/**
 * Filtro de fase por defecto según el área del usuario (supervisor con área ve
 * su fase preseleccionada; puede cambiarla). Sin área / dirección / owner-admin
 * sin área → 'todos'. Operator ya ve solo sus negocios (filtro server).
 */
function defaultStageFilter(role: string | null, areas: string[]): StageFilter {
  if (!areas || areas.length === 0) return 'todos'
  const ef = getAreasEfectivas({ id: '', role: (role ?? 'read_only') as Role, areas: areas as Area[] })
  if (ef.has('comercial') && ef.has('operaciones') && ef.has('financiera')) return 'todos' // dirección
  if (ef.has('comercial')) return 'venta'
  if (ef.has('operaciones')) return 'ejecucion'
  if (ef.has('financiera')) return 'cobro'
  return 'todos'
}

export default async function NegociosPage() {
  const [abiertos, cerrados, stagesActivos, etapas, ws, staffList] = await Promise.all([
    getNegociosV2('abierto'),
    getNegociosV2('completado'),
    getWorkspaceStagesActivos(),
    getEtapasSegmentador(),
    getWorkspace(),
    getStaffParaAsignarNegocio(),
  ])
  const defaultStage = defaultStageFilter(ws.role, ws.areas)
  // Mismo gate que validan `agregarResponsable`/`quitarResponsable` server-side
  // (owner/admin/supervisor): replicado en UI para no ofrecer un control que fallaría.
  const canAsignar = getRolePermissions(ws.role ?? 'read_only').canAssignResponsable
  // Mismo guard que validan `agregarMarcaNegocio`/`quitarMarcaNegocio`.
  const canMarcar = puedeMarcarCondicionNegocio(ws.role)
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
      <NegociosClient
        negocios={abiertos}
        cerrados={cerrados}
        stagesActivos={stagesActivos}
        etapas={etapas}
        defaultStage={defaultStage}
        staffList={staffList}
        canAsignar={canAsignar}
        canMarcar={canMarcar}
      />
    </div>
  )
}
