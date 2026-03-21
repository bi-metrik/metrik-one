import { getOportunidad } from '../actions-v2'
import { notFound } from 'next/navigation'
import OportunidadDetail from './oportunidad-detail'
import { getCotizaciones } from './cotizaciones/actions-v2'
import { getActiveStaffList } from '@/lib/actions/get-staff-list'

export default async function OportunidadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [oportunidad, cotizaciones, staffList] = await Promise.all([
    getOportunidad(id),
    getCotizaciones(id),
    getActiveStaffList(),
  ])

  if (!oportunidad) notFound()

  return <OportunidadDetail oportunidad={oportunidad} cotizaciones={cotizaciones} staffList={staffList} />
}
