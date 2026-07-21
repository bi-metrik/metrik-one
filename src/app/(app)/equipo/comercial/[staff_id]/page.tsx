import { notFound, redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getComercialPerfil, getComercialResumen } from '../../comercial-actions'
import { computeRanking, rankingDePersona } from '../../comercial-ranking'
import ComercialPerfilClient from './comercial-perfil-client'

interface Props {
  params: Promise<{ staff_id: string }>
}

export default async function ComercialPerfilPage({ params }: Props) {
  const { staff_id } = await params
  const { supabase, workspaceId, role, staffId } = await getWorkspace()
  if (!workspaceId || !supabase) redirect('/negocios')

  // Solo workspaces con el tablero comercial sobre negocios lo exponen.
  const { data: ws } = await supabase.from('workspaces').select('modules').eq('id', workspaceId).single()
  const modules = (ws?.modules as Record<string, boolean> | null) ?? {}
  if (!modules.comercial_negocios) redirect('/equipo')

  // Acceso: gerencia (owner/admin/supervisor) ve cualquier perfil. El vendedor
  // (operator) ve SOLO el suyo; si intenta abrir otro staff_id, se le redirige al
  // propio. Sin staff resuelto, no puede ver perfiles.
  const esGerencial = ['owner', 'admin', 'supervisor'].includes(role || '')
  if (!esGerencial) {
    if (role === 'operator' && staffId) {
      if (staff_id !== staffId) redirect(`/equipo/comercial/${staffId}`)
    } else {
      redirect('/negocios')
    }
  }

  const [perfil, resumen] = await Promise.all([
    getComercialPerfil(staff_id),
    getComercialResumen(),
  ])
  if (!perfil) notFound()

  // Posicion de esta persona en el ranking del equipo (null para el bucket sin responsable).
  const ranking = computeRanking(resumen)
  const miRanking = rankingDePersona(ranking, perfil.sin_responsable ? null : staff_id)

  return (
    <ComercialPerfilClient
      perfil={perfil}
      ranking={miRanking}
      totalEquipo={ranking.total}
    />
  )
}
