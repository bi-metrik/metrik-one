import Link from 'next/link'
import { Plus } from 'lucide-react'
import { getWorkspaceStagesActivos, getStaffParaAsignarNegocio } from './negocio-v2-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions, puedeDescargarNegocios, puedeMarcarCondicionNegocio } from '@/lib/roles'
import NegociosClient from './negocios-client'
import { usaAlmacenamientoExterno } from '@/lib/almacenamiento/proveedor'
import { cargarVistaLista } from '@/lib/negocios/cargar-vista-lista'
import type { SearchParams } from '@/lib/filtros/url-estado'

export default async function NegociosPage({
  searchParams,
}: {
  // Los filtros de la lista viajan en la URL para sobrevivir al volver atrás. El servidor
  // los resuelve aquí: filtra, cuenta y manda SOLO la primera página de tarjetas (ver
  // `lib/negocios/vista-lista.ts`, por qué dejó de mandar la lista entera).
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const ws = await getWorkspace()
  // Mismo gate que validan `agregarResponsable`/`quitarResponsable` server-side
  // (owner/admin/supervisor): replicado en UI para no ofrecer un control que fallaría.
  const canAsignar = getRolePermissions(ws.role ?? 'read_only').canAssignResponsable
  const [vista, stagesActivos, staffList] = await Promise.all([
    cargarVistaLista(sp),
    getWorkspaceStagesActivos(),
    // El selector de responsable solo se pinta a quien puede asignar.
    canAsignar ? getStaffParaAsignarNegocio() : Promise.resolve([]),
  ])
  // Mismo guard que validan `agregarMarcaNegocio`/`quitarMarcaNegocio`.
  const canMarcar = puedeMarcarCondicionNegocio(ws.role)
  // Mismo gate que aplica `POST /api/negocios/export` (owner/admin/supervisor).
  const canDescargar = puedeDescargarNegocios(ws.role)
  // La hoja viva en Drive no se ofrece donde el workspace guarda sus archivos fuera de
  // Drive (el servidor tambien la rechaza). Si la marca no se puede leer, no se ofrece.
  const canPublicarEnDrive = ws.workspaceId
    ? !(await usaAlmacenamientoExterno(ws.workspaceId).catch(() => true))
    : false
  const abiertos = vista?.resumen.totalAbiertos ?? 0
  const cerrados = vista?.resumen.totalCerrados ?? 0
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Negocios</h1>
          <p className="text-xs text-muted-foreground">
            {abiertos} abierto{abiertos !== 1 ? 's' : ''}
            {cerrados > 0 && ` · ${cerrados} cerrado${cerrados !== 1 ? 's' : ''}`}
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
      {vista && (
        <NegociosClient
          vista={vista}
          stagesActivos={stagesActivos}
          staffList={staffList}
          canAsignar={canAsignar}
          canMarcar={canMarcar}
          canDescargar={canDescargar}
          canPublicarEnDrive={canPublicarEnDrive}
        />
      )}
    </div>
  )
}
