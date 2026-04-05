import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getNegocioDetalle } from '../negocio-v2-actions'
import NegocioDetailClient from './negocio-detail-client'

interface Props {
  params: Promise<{ id: string }>
}

export default async function NegocioDetailPage({ params }: Props) {
  const { id } = await params
  const data = await getNegocioDetalle(id)

  if (!data) notFound()

  return (
    <NegocioDetailClient
      negocio={data.negocio}
      bloques={data.bloques}
      etapasLinea={data.etapasLinea}
    />
  )
}
