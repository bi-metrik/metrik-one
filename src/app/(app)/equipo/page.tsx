import { redirect } from 'next/navigation'
import { getHoras, getEquipoFilterOptions } from './actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { bogotaYearMonth } from '@/lib/dates/bogota'
import EquipoClient from './equipo-client'
import VendedoresClient from './vendedores-client'
import ComercialClient from './comercial-client'
import { getVendedoresResumen } from './vendedores-actions'
import { getComercialResumen, getComercialMes, getComercialSerie, getMetasComerciales } from './comercial-actions'

interface Props {
  searchParams: Promise<{ mes?: string; staff?: string; proyecto?: string; estado?: string }>
}

export default async function EquipoPage({ searchParams }: Props) {
  const params = await searchParams
  const mes = params.mes ?? bogotaYearMonth()
  const staff = params.staff ?? 'todos'
  const proyecto = params.proyecto ?? 'todos'
  const estado = params.estado ?? 'todos'

  const { supabase, workspaceId, role } = await getWorkspace()

  // Workspaces de Rentabilidad Comercial: Equipo muestra vendedores (derivados de ventas_hechos),
  // visible tambien a read_only. No aplica el flujo de gestion de horas/staff.
  if (workspaceId && supabase) {
    const { data: ws } = await supabase.from('workspaces').select('modules').eq('id', workspaceId).single()
    const modules = (ws?.modules as Record<string, boolean> | null) ?? {}
    if (modules.rentabilidad_comercial) {
      const vendedores = await getVendedoresResumen()
      return <VendedoresClient vendedores={vendedores} />
    }
    // Workspaces cuyo pipeline vive en negocios (Clarity, ej. SOENA): tablero
    // comercial por responsable sobre negocios + responsable_id. Visible a quien
    // gestiona equipo.
    if (modules.comercial_negocios) {
      const perms = getRolePermissions(role || '')
      if (!perms.canManageTeam) redirect('/negocios')
      // Mes seleccionado (default: mes actual Bogota).
      const [anioStr, mesStr] = mes.split('-')
      const anioSel = Number(anioStr)
      const mesSel = Number(mesStr)
      const [equipo, mesData, serie, metas] = await Promise.all([
        getComercialResumen(),
        getComercialMes(anioSel, mesSel),
        getComercialSerie(12),
        getMetasComerciales(anioSel, mesSel),
      ])
      // Editar metas: misma puerta que conciliacion (owner/admin/supervisor).
      const puedeEditarMetas = ['owner', 'admin', 'supervisor'].includes(role || '')
      return (
        <ComercialClient
          equipo={equipo}
          mesInicial={mesData}
          serie={serie}
          metasIniciales={metas}
          anioInicial={anioSel}
          mesNumInicial={mesSel}
          puedeEditarMetas={puedeEditarMetas}
        />
      )
    }
  }

  const perms = getRolePermissions(role || '')
  if (!perms.canManageTeam) redirect('/negocios')

  const [{ horas, totales }, { staff: staffList, proyectos }] = await Promise.all([
    getHoras({ mes, staff, proyecto, estado }),
    getEquipoFilterOptions(),
  ])

  return (
    <EquipoClient
      horas={horas}
      totales={totales}
      filtroMes={mes}
      filtroStaff={staff}
      filtroProyecto={proyecto}
      filtroEstado={estado}
      staffList={staffList}
      proyectos={proyectos}
      role={role ?? 'read_only'}
    />
  )
}
