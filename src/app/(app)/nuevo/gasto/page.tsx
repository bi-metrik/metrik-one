import { getProyectosParaGasto } from './gasto-action'
import NuevoGastoForm from './nuevo-gasto-form'

export default async function NuevoGastoPage({ searchParams }: { searchParams: Promise<{ proyecto?: string }> }) {
  const [proyectos, params] = await Promise.all([getProyectosParaGasto(), searchParams])
  return <NuevoGastoForm proyectos={proyectos} defaultProyectoId={params.proyecto} />
}
