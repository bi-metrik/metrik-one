import { redirect } from 'next/navigation'
import { createCotizacionDetalladaNegocio } from '../actions'

export default async function NuevaCotizacionNegocioPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let res: { success: boolean; id?: string; error?: string }
  try {
    res = await createCotizacionDetalladaNegocio(id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error inesperado'
    redirect(`/negocios/${id}?err=${encodeURIComponent(msg)}`)
  }

  if (!res.success) {
    redirect(`/negocios/${id}?err=${encodeURIComponent(res.error ?? 'Error al crear cotización')}`)
  }
  redirect(`/negocios/${id}/cotizacion/${res.id}`)
}
