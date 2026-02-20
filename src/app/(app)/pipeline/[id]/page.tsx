import { getOportunidad } from '../actions-v2'
import { notFound } from 'next/navigation'
import OportunidadDetail from './oportunidad-detail'
import { getCotizaciones } from './cotizaciones/actions-v2'

export default async function OportunidadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [oportunidad, cotizaciones] = await Promise.all([
    getOportunidad(id),
    getCotizaciones(id),
  ])

  if (!oportunidad) notFound()

  return <OportunidadDetail oportunidad={oportunidad} cotizaciones={cotizaciones} />
}
