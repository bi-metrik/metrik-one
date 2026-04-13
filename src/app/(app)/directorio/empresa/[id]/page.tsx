import { getEmpresa, getOportunidadesPorEmpresa, getProyectosPorEmpresa, getNegociosPorEmpresa } from '../../actions'
import { notFound } from 'next/navigation'
import Empresa360 from './empresa-360'

export default async function EmpresaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [empresa, oportunidades, proyectos, negocios] = await Promise.all([
    getEmpresa(id),
    getOportunidadesPorEmpresa(id),
    getProyectosPorEmpresa(id),
    getNegociosPorEmpresa(id),
  ])

  if (!empresa) notFound()

  return <Empresa360 empresa={empresa} oportunidades={oportunidades} proyectos={proyectos} negocios={negocios} />
}
