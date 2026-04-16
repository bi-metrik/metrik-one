import { notFound } from 'next/navigation'
import { getNegocioDetalleCompleto } from '../negocio-v2-actions'
import NegocioDetailClient from './negocio-detail-client'

export const maxDuration = 60

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ err?: string }>
}

export default async function NegocioDetailPage({ params, searchParams }: Props) {
  const { id } = await params
  const { err } = await searchParams
  const data = await getNegocioDetalleCompleto(id)

  if (!data) notFound()

  return (
    <NegocioDetailClient
      negocio={data.negocio}
      bloques={data.bloques}
      etapasLinea={data.etapasLinea}
      profiles={data.profiles}
      currentUserId={data.currentUserId}
      userRole={data.userRole}
      cobros={data.cobros}
      cotizacionesNegocio={data.cotizacionesNegocio}
      resumenFinanciero={data.resumenFinanciero}
      ejecucionData={data.ejecucionData}
      historialData={data.historialData}
      actividad={data.actividad}
      staffList={data.staffList}
      datosOtrasEtapas={data.datosOtrasEtapas}
      errorMsg={err}
    />
  )
}
