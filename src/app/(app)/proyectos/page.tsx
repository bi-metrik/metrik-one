import { getProyectos } from './actions-v2'
import { getActiveTimer } from '../timer-actions'
import ProyectosList from './proyectos-list'

export default async function ProyectosPage() {
  const [proyectos, activeTimer] = await Promise.all([
    getProyectos(),
    getActiveTimer(),
  ])

  return <ProyectosList proyectos={proyectos} activeTimer={activeTimer} />
}
