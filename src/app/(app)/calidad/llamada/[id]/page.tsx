import { notFound, redirect } from 'next/navigation'
import { getContextoCalidad, getLlamadaDetalle } from '../../actions'
import DetalleClient from './detalle-client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function LlamadaPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContextoCalidad()
  if (!ctx) redirect('/')

  const { id } = await params

  // getLlamadaDetalle repite el filtro del ejecutor. Un operator que teclee el
  // id de una llamada ajena recibe null y cae en 404: filtrar solo la lista
  // dejaria esa URL abierta.
  const llamada = await getLlamadaDetalle(id)
  if (!llamada) notFound()

  return <DetalleClient llamada={llamada} />
}
