import { getDestinosParaHoras, getStaffActivo } from './horas-action'
import NuevoHorasForm from './nuevo-horas-form'

export default async function NuevoHorasPage({ searchParams }: { searchParams: Promise<{ proyecto?: string; negocio?: string }> }) {
  const [destinos, staff, params] = await Promise.all([
    getDestinosParaHoras(),
    getStaffActivo(),
    searchParams,
  ])
  return <NuevoHorasForm destinos={destinos} staff={staff} defaultProyectoId={params.proyecto} defaultNegocioId={params.negocio} />
}
