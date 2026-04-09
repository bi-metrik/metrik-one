import { notFound } from 'next/navigation'
import { getRiesgo, getControlesRiesgo, getEquipoParaRiesgo } from '@/lib/actions/riesgos'
import RiesgoDetail from './riesgo-detail'

export default async function RiesgoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [riesgo, controles, equipo] = await Promise.all([
    getRiesgo(id),
    getControlesRiesgo(id),
    getEquipoParaRiesgo(),
  ])

  if (!riesgo) notFound()

  return <RiesgoDetail riesgo={riesgo} controles={controles} equipo={equipo} />
}
