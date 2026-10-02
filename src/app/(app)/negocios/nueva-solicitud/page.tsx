import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { lineaSolicitudTexto } from '@/lib/negocios/solicitud-texto-servidor'
import NuevaSolicitud from './nueva-solicitud'

/**
 * «Nueva solicitud» (Noor, 2026-10-02): la entrada de un viaje nuevo en la línea de solicitud de
 * viaje. Se pega o se escribe lo que contó el cliente, el motor del bot lo entiende y el cliente
 * se resuelve DESPUÉS («¿De quién es?»). Sin la caja (otro workspace u otra línea), el alta de
 * siempre.
 */
export default async function NuevaSolicitudPage({
  searchParams,
}: {
  searchParams: Promise<{ contacto_id?: string }>
}) {
  const { workspaceId } = await getWorkspace()
  if (!workspaceId) redirect('/login')
  const sp = await searchParams
  if (!(await lineaSolicitudTexto(workspaceId))) {
    redirect(sp.contacto_id ? `/negocios/nuevo?contacto_id=${encodeURIComponent(sp.contacto_id)}` : '/negocios/nuevo')
  }
  return <NuevaSolicitud contactoId={sp.contacto_id ?? null} />
}
