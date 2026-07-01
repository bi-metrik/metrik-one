'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { slugVendedor, type VendedorResumen, type VendedorPerfil } from './vendedores-types'

export async function getVendedoresResumen(): Promise<VendedorResumen[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('get_vendedores_resumen')
  return (data as VendedorResumen[]) ?? []
}

export async function getVendedorPerfil(slug: string): Promise<VendedorPerfil | null> {
  const lista = await getVendedoresResumen()
  const match = lista.find(v => slugVendedor(v.vendedor) === slug)
  if (!match) return null
  const { supabase } = await getWorkspace()
  if (!supabase) return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).rpc('get_vendedor_perfil', { p_vendedor: match.vendedor })
  if (!data) return null
  return data as VendedorPerfil
}
