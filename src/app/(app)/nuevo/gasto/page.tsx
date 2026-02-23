import { getProyectosParaGasto } from './gasto-action'
import NuevoGastoForm from './nuevo-gasto-form'

export default async function NuevoGastoPage() {
  const proyectos = await getProyectosParaGasto()
  return <NuevoGastoForm proyectos={proyectos} />
}
