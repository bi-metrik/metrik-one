import { getHoras, getEquipoFilterOptions } from './actions'
import { getWorkspace } from '@/lib/actions/get-workspace'
import EquipoClient from './equipo-client'

interface Props {
  searchParams: Promise<{ mes?: string; staff?: string; proyecto?: string; estado?: string }>
}

export default async function EquipoPage({ searchParams }: Props) {
  const params = await searchParams
  const mes = params.mes ?? new Date().toISOString().slice(0, 7)
  const staff = params.staff ?? 'todos'
  const proyecto = params.proyecto ?? 'todos'
  const estado = params.estado ?? 'todos'

  const [{ horas, totales }, { staff: staffList, proyectos }, { role }] = await Promise.all([
    getHoras({ mes, staff, proyecto, estado }),
    getEquipoFilterOptions(),
    getWorkspace(),
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
