import { notFound } from 'next/navigation'
import NegocioDetailClient from './negocio-detail-client'
import { cargarVistaNegocio } from './vista-negocio'

export const maxDuration = 60

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ err?: string }>
}

export default async function NegocioDetailPage({ params, searchParams }: Props) {
  const { id } = await params
  const { err } = await searchParams
  const vista = await cargarVistaNegocio(id)
  if (!vista) notFound()
  return <NegocioDetailClient {...vista} errorMsg={err} />
}
