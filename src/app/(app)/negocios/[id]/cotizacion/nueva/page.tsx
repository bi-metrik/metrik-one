import ModoSelectorNegocio from './modo-selector-negocio'

export default async function NuevaCotizacionNegocioPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ModoSelectorNegocio negocioId={id} />
}
