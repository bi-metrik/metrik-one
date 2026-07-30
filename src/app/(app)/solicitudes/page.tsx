import { redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getSolicitudes } from '@/lib/actions/solicitudes-llamada'
import SolicitudesClient from './solicitudes-client'

export const runtime = 'nodejs'

export default async function SolicitudesPage() {
  const ws = await getWorkspace()
  if (!ws.workspaceId) redirect('/login')

  // Módulo opt-in: solo workspaces con el bot de servicio activo.
  const { data: wsRow } = await ws.supabase
    .from('workspaces')
    .select('modules')
    .eq('id', ws.workspaceId)
    .single()

  const modules = (wsRow as { modules: Record<string, boolean> | null } | null)?.modules
  if (!modules?.wa_customer_bot) redirect('/numeros')

  // El action revalida el rol server-side; ocultar el item del menú no impide
  // teclear la URL.
  const { data, error } = await getSolicitudes()
  if (error || !data) redirect('/numeros')

  return <SolicitudesClient solicitudes={data} />
}
