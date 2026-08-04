import { redirect } from 'next/navigation'
import { getHoras, getEquipoFilterOptions } from './actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { bogotaYearMonth } from '@/lib/dates/bogota'
import EquipoClient from './equipo-client'
import VendedoresClient from './vendedores-client'
import EquipoComercialPersonasClient from './equipo-comercial-personas-client'
import { getVendedoresResumen } from './vendedores-actions'
import { getComercialResumen, getComercialMes, getMetasPorVendedorPeriodo } from './comercial-actions'
import { getEquipoCalidad } from '../calidad/actions'
import EquipoCalidadClient from './equipo-calidad-client'

interface Props {
  searchParams: Promise<{ mes?: string; staff?: string; proyecto?: string; estado?: string }>
}

export default async function EquipoPage({ searchParams }: Props) {
  const params = await searchParams
  const mes = params.mes ?? bogotaYearMonth()
  const staff = params.staff ?? 'todos'
  const proyecto = params.proyecto ?? 'todos'
  const estado = params.estado ?? 'todos'

  const { supabase, workspaceId, role, staffId } = await getWorkspace()

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
    // Equipo = hoja de indicadores POR PERSONA (con ranking). El tablero AGREGADO
    // vive en la pestaña "Comercial" de /tableros. Acceso: owner/admin/supervisor.
    // Auditoria de calidad de llamadas (call centers): Equipo es el ranking de
    // agentes con su tendencia, y el ejecutor ve SOLO su propia hoja. Es la
    // tercera forma de esta misma ruta, con la misma logica que la de abajo:
    // una ruta, contenido por rol. No se invento un patron, se escribio otra
    // instancia del que ya existe.
    //
    // Va gateada por su flag y ANTES del fallthrough generico. Los modulos son
    // disjuntos (ningun workspace tiene `business` y `calidad_llamadas` a la
    // vez), asi que esta rama es inalcanzable para SOENA y para HJBC. Si alguna
    // vez se crea un workspace con los dos, el orden de las ramas decide y hay
    // que resolverlo aqui a proposito, no descubrirlo en pantalla.
    if (modules.calidad_llamadas) {
      // El permiso NO se escribe de nuevo: `canViewCalidadTodos` ya existe y ya
      // gobierna la lista de llamadas y las rutas del motor. Quien puede ver a
      // todos, ve el ranking; quien no, ve su propia hoja. Un solo booleano.
      if (!getRolePermissions(role || '').canViewCalidadTodos) {
        // `/calidad/mi-perfil` resuelve el agente por `agente_staff_id` (no por
        // nombre) y redirige a su perfil. Sin ese puente habria que repetir la
        // resolucion aqui.
        redirect('/calidad/mi-perfil')
      }
      const datos = await getEquipoCalidad()
      // Fallback a `/calidad`, no a `/negocios`: en un workspace de solo
      // calidad, Negocios es un callejon sin salida.
      if (!datos) redirect('/calidad')
      return <EquipoCalidadClient datos={datos} />
    }

    // Operativo del area de operaciones: su hoja del bono es su vista de Equipo.
    // Va ANTES de la rama comercial porque un workspace puede tener los dos
    // modulos, y quien trabaja en operaciones no tiene nada que hacer en el
    // tablero de vendedores. Se resuelve por AREA (`staff_areas`), no por el
    // texto de `position`, que es campo libre.
    if (modules.operaciones_bonos && role === 'operator' && staffId) {
      const { data: areas } = await supabase
        .from('staff_areas')
        .select('area')
        .eq('staff_id', staffId)
      const esOperaciones = ((areas ?? []) as Array<{ area: string }>).some(a => a.area === 'operaciones')
      if (esOperaciones) redirect(`/equipo/operaciones/${staffId}`)
    }

    if (modules.comercial_negocios) {
      // El vendedor (operator) ve SOLO su propia hoja: se le redirige a su perfil.
      // Sin staff resuelto, no hay hoja que mostrar -> a Negocios.
      const esGerencial = ['owner', 'admin', 'supervisor'].includes(role || '')
      if (!esGerencial) {
        if (role === 'operator' && staffId) redirect(`/equipo/comercial/${staffId}`)
        redirect('/negocios')
      }
      const [anioStr, mesStr] = mes.split('-')
      const anioSel = Number(anioStr)
      const mesSel = Number(mesStr)
      const [resumen, mesData, metasMap] = await Promise.all([
        getComercialResumen(),
        getComercialMes(anioSel, mesSel),
        getMetasPorVendedorPeriodo(anioSel, mesSel),
      ])
      return (
        <EquipoComercialPersonasClient
          resumen={resumen}
          mesData={mesData}
          anio={anioSel}
          mes={mesSel}
          metasPorVendedor={Array.from(metasMap)}
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
