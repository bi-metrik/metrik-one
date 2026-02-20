import { getProyectos } from './actions-v2'
import ProyectosList from './proyectos-list'

export default async function ProyectosPage() {
  const proyectos = await getProyectos()

  return <ProyectosList proyectos={proyectos} />
}
