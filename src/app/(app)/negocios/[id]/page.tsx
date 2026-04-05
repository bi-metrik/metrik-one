import { notFound } from 'next/navigation'
import { getNegocioDetalleCompleto } from '../negocio-v2-actions'
import NegocioDetailClient from './negocio-detail-client'

interface Props {
  params: Promise<{ id: string }>
}

export default async function NegocioDetailPage({ params }: Props) {
  const { id } = await params
  const data = await getNegocioDetalleCompleto(id)

  if (!data) notFound()

  return (
    <NegocioDetailClient
      negocio={data.negocio}
      bloques={data.bloques}
      etapasLinea={data.etapasLinea}
      profiles={data.profiles}
      currentUserId={data.currentUserId}
      cobros={data.cobros}
      cotizacionesNegocio={data.cotizacionesNegocio}
      resumenFinanciero={data.resumenFinanciero}
      actividad={data.actividad}
      staffList={data.staffList}
    />
  )
}
