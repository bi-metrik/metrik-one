import { getOportunidad } from '../actions-v2'
import { notFound } from 'next/navigation'
import OportunidadDetail from './oportunidad-detail'
import { getCotizaciones } from './cotizaciones/actions-v2'
import { getActiveStaffList } from '@/lib/actions/get-staff-list'
import { getVeDocumentos } from '@/lib/actions/ve-documentos'

export default async function OportunidadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [oportunidad, cotizaciones, staffList] = await Promise.all([
    getOportunidad(id),
    getCotizaciones(id),
    getActiveStaffList(),
  ])

  if (!oportunidad) notFound()

  // Cargar datos VE solo si la oportunidad es de linea_negocio = 've'
  const customData = oportunidad.custom_data as Record<string, unknown> | null
  const esVe = customData?.linea_negocio === 've'

  const veData = esVe
    ? await getVeDocumentos(id)
    : { docs: [], vehiculoEnUpme: null, camposVehiculo: null }

  return (
    <OportunidadDetail
      oportunidad={oportunidad}
      cotizaciones={cotizaciones}
      staffList={staffList}
      veDocumentos={veData.docs}
      veVehiculoEnUpme={veData.vehiculoEnUpme}
      veCamposVehiculo={veData.camposVehiculo}
    />
  )
}
