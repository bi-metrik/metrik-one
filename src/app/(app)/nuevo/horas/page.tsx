import { getProyectosParaHoras, getStaffActivo } from './horas-action'
import NuevoHorasForm from './nuevo-horas-form'

export default async function NuevoHorasPage({ searchParams }: { searchParams: Promise<{ proyecto?: string }> }) {
  const [proyectos, staff, params] = await Promise.all([
    getProyectosParaHoras(),
    getStaffActivo(),
    searchParams,
  ])
  return <NuevoHorasForm proyectos={proyectos} staff={staff} defaultProyectoId={params.proyecto} />
}
