import { notFound, redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { getComercialPerfil } from '../../comercial-actions'
import ComercialPerfilClient from './comercial-perfil-client'

interface Props {
  params: Promise<{ staff_id: string }>
}

export default async function ComercialPerfilPage({ params }: Props) {
  const { staff_id } = await params
  const { supabase, workspaceId, role } = await getWorkspace()
  if (!workspaceId || !supabase) redirect('/negocios')

  // Solo workspaces con el tablero comercial sobre negocios lo exponen.
  const { data: ws } = await supabase.from('workspaces').select('modules').eq('id', workspaceId).single()
  const modules = (ws?.modules as Record<string, boolean> | null) ?? {}
  if (!modules.comercial_negocios) redirect('/equipo')

  const perms = getRolePermissions(role || '')
  if (!perms.canManageTeam) redirect('/negocios')

  const perfil = await getComercialPerfil(staff_id)
  if (!perfil) notFound()

  return <ComercialPerfilClient perfil={perfil} />
}
