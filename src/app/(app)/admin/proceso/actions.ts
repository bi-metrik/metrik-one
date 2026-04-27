'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getWorkspace } from '@/lib/actions/get-workspace'

export interface EtapaRow {
  id: string
  linea: string
  fase: string
  nombre: string
  slug: string
  orden: number
  skill_name: string | null
  skill_estado: string
  descripcion: string | null
  inputs: InputOutput[]
  outputs: InputOutput[]
  gates_entrada: Gate[]
  bloques: Bloque[]
  paralelo_con: string[] | null
  notas: string | null
  created_at: string
  updated_at: string
}

export interface InputOutput {
  nombre: string
  tipo: string
  fuente?: string
  destino?: string
  requerido?: boolean
}

export interface Gate {
  condicion: string
  descripcion: string
}

export interface Bloque {
  nombre: string
  tipo: string
  descripcion: string
}

async function requireAdmin(): Promise<string | null> {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) {
    return 'forbidden'
  }
  return null
}

export async function listEtapas(linea = 'clarity'): Promise<EtapaRow[]> {
  const err = await requireAdmin()
  if (err) return []
  const svc = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await ((svc as any).from('admin_proceso_etapas'))
    .select('*')
    .eq('linea', linea)
    .order('orden', { ascending: true })
  if (error) return []
  return (data ?? []) as EtapaRow[]
}
