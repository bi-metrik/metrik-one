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
    redirect(`/negocios/${id}`)
  }
  redirect(`/negocios/${id}/cotizacion/${res.id}`)
}
