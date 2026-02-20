import ModoSelector from './modo-selector'

export default async function NuevaCotizacionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ModoSelector oportunidadId={id} />
}
