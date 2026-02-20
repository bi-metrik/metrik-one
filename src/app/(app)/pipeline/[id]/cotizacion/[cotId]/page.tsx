import { getCotizacion, getCotizacionItems } from '../../cotizaciones/actions-v2'
import { notFound } from 'next/navigation'
import CotizacionEditor from './cotizacion-editor'

export default async function CotizacionDetailPage({ params }: { params: Promise<{ id: string; cotId: string }> }) {
  const { id, cotId } = await params
  const [cotizacion, items] = await Promise.all([
    getCotizacion(cotId),
    getCotizacionItems(cotId),
  ])

  if (!cotizacion) notFound()

  return <CotizacionEditor oportunidadId={id} cotizacion={cotizacion} initialItems={items} />
}
