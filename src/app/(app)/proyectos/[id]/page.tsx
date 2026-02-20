import { notFound } from 'next/navigation'
import { getProyectoDetalle } from '../actions-v2'
import ProyectoDetail from './proyecto-detail'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProyectoDetailPage({ params }: Props) {
  const { id } = await params
  const data = await getProyectoDetalle(id)

  if (!data) notFound()

  return (
    <ProyectoDetail
      financiero={data.financiero}
      rubros={data.rubros}
      facturas={data.facturas}
      timeline={data.timeline}
      rubrosLista={data.rubrosLista}
    />
  )
}
