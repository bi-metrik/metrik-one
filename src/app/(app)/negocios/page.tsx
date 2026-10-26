import Link from 'next/link'
import { Plus } from 'lucide-react'
import { getWorkspaceStagesActivos, getStaffParaAsignarNegocio } from './negocio-v2-actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { puedeDescargarNegocios, puedeMarcarCondicionNegocio } from '@/lib/roles'
import { puedeAsignarResponsableEnWorkspace } from '@/lib/permissions/asignar-responsable-servidor'
import { puedeDescargarNegociosDelWorkspace } from '@/lib/negocios/permiso-descarga'
import NegociosClient from './negocios-client'
import { usaAlmacenamientoExterno } from '@/lib/almacenamiento/proveedor'
import { cargarVistaLista } from '@/lib/negocios/cargar-vista-lista'
import type { SearchParams } from '@/lib/filtros/url-estado'
import { cargarMisPendientes, pestanaDeViaje } from '@/lib/viaje/mis-pendientes-datos'
import MisPendientes from './mis-pendientes'
import Agenda from './agenda'

/**
 * «Negocios · Mis pendientes»: dos pestañas con enlace, sin estado en el cliente. Con los hitos de
 * gestión encendidos en alguna línea, la segunda se llama «Agenda» (misma URL).
 */
function PestanasNegocios({ activa, agenda = false }: { activa: 'negocios' | 'pendientes'; agenda?: boolean }) {
  const clase = (on: boolean) => `inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium ${on ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`
  return (
    <nav className="mb-4 flex gap-1 border-b" aria-label="Vistas de negocios">
      <Link href="/negocios" className={clase(activa === 'negocios')} aria-current={activa === 'negocios' ? 'page' : undefined}>Negocios</Link>
      <Link href="/negocios?vista=pendientes" className={clase(activa === 'pendientes')} aria-current={activa === 'pendientes' ? 'page' : undefined}>{agenda ? 'Agenda' : 'Mis pendientes'}</Link>
    </nav>
  )
}

export default async function NegociosPage({
  searchParams,
}: {
  // Los filtros de la lista viajan en la URL para sobrevivir al volver atrás. El servidor
  // los resuelve aquí: filtra, cuenta y manda SOLO la primera página de tarjetas (ver
  // `lib/negocios/vista-lista.ts`, por qué dejó de mandar la lista entera).
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  // «Mis pendientes» (F6-9): pestaña dentro de /negocios, solo en espacios con líneas de viaje.
  // La consulta corre en paralelo con la lista: no le suma latencia a la vista de siempre.
  const pestanaP = pestanaDeViaje().catch(() => ({ hay: false, agenda: false }))
  const conPendientesP = pestanaP.then(p => p.hay)
  if (sp.vista === 'pendientes' && (await conPendientesP)) {
    const mp = await cargarMisPendientes()
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <PestanasNegocios activa="pendientes" agenda={mp.activo && !!mp.agenda} />
        {!mp.activo ? null : mp.agenda ? (
          <Agenda datos={mp.agenda} pendientes={mp.pendientes} servicios={mp.servicios} hoy={mp.hoy} proximo={mp.proximo} tablero={mp.tablero} />
        ) : (
          <MisPendientes pendientes={mp.pendientes} servicios={mp.servicios} hoy={mp.hoy} proximo={mp.proximo} tablero={mp.tablero} />
        )}
      </div>
    )
  }
  const ws = await getWorkspace()
  // MISMA función que el guard de `agregarResponsable`/`quitarResponsable`:
  // owner/admin/supervisor, o la persona en `config_extra.asignar_responsable.staff_ids`.
  const canAsignar = await puedeAsignarResponsableEnWorkspace(ws.workspaceId, { role: ws.role, staffId: ws.staffId })
  const [vista, stagesActivos, staffList, conPendientes] = await Promise.all([
    cargarVistaLista(sp),
    getWorkspaceStagesActivos(),
    // El selector de responsable solo se pinta a quien puede asignar.
    canAsignar ? getStaffParaAsignarNegocio() : Promise.resolve([]),
    conPendientesP,
  ])
  // Mismo guard que validan `agregarMarcaNegocio`/`quitarMarcaNegocio`.
  const canMarcar = puedeMarcarCondicionNegocio(ws.role)
  // Mismo gate que aplica `POST /api/negocios/export` (owner/admin/supervisor, más los
  // roles que sume el workspace en `config_extra.roles_descarga_negocios_extra`).
  const canDescargar = await puedeDescargarNegociosDelWorkspace(ws.supabase, ws.workspaceId, ws.role)
  // La hoja viva en Drive no se ofrece donde el workspace guarda sus archivos fuera de
  // Drive (el servidor tambien la rechaza). Si la marca no se puede leer, no se ofrece.
  // Y solo con el permiso DEFAULT, sin los roles que suma el workspace (SOE-028): la hoja
  // es una sola y se sobrescribe, y un operator la dejaría con solo sus negocios. Es el
  // mismo gate de `subirExportNegociosADrive`.
  const canPublicarEnDrive = puedeDescargarNegocios(ws.role) && ws.workspaceId
    ? !(await usaAlmacenamientoExterno(ws.workspaceId).catch(() => true))
    : false
  const abiertos = vista?.resumen.totalAbiertos ?? 0
  const cerrados = vista?.resumen.totalCerrados ?? 0
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {conPendientes && <PestanasNegocios activa="negocios" agenda={(await pestanaP).agenda} />}
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
