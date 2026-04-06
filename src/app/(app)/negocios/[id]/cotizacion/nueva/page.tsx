import { redirect } from 'next/navigation'
import { createCotizacionDetalladaNegocio } from '../actions'

export default async function NuevaCotizacionNegocioPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const res = await createCotizacionDetalladaNegocio(id)
  if (!res.success) {
    // Pasar el error como param para que la página del negocio lo muestre
    redirect(`/negocios/${id}?err=${encodeURIComponent(res.error ?? 'Error al crear cotización')}`)
  }
  redirect(`/negocios/${id}/cotizacion/${res.id}`)
}
