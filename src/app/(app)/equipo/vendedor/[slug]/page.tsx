import { notFound, redirect } from 'next/navigation'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getVendedorPerfil } from '../../vendedores-actions'
import VendedorPerfilClient from './vendedor-perfil-client'

interface Props { params: Promise<{ slug: string }> }

export default async function VendedorPerfilPage({ params }: Props) {
  const { slug } = await params
  const { supabase, workspaceId } = await getWorkspace()
  if (!workspaceId || !supabase) redirect('/negocios')

  // Solo workspaces de Rentabilidad Comercial exponen perfiles de vendedor.
  const { data: ws } = await supabase.from('workspaces').select('modules').eq('id', workspaceId).single()
  const modules = (ws?.modules as Record<string, boolean> | null) ?? {}
  if (!modules.rentabilidad_comercial) redirect('/equipo')

  const perfil = await getVendedorPerfil(slug)
  if (!perfil || !perfil.existe) notFound()

  return <VendedorPerfilClient perfil={perfil} />
}
