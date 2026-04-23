'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getWorkspace } from '@/lib/actions/get-workspace'

const SIGNED_URL_TTL = 60 * 5 // 5 min

export interface WorkflowRow {
  id: string
  cliente_slug: string
  cliente_nombre: string | null
  proyecto_slug: string
  nombre_flujo: string
  version: number
  linea_negocio: string
  tipo_proceso: string | null
  fase_cubierta: string[] | null
  fase_detallada: string | null
  estado: string
  tags: string[]
  autor_proceso: string | null
  autor_tecnico: string | null
  owner_calidad: string | null
  basado_en: string | null
  total_fases: number | null
  total_etapas: number | null
  total_bloques: number | null
  tiene_condicionales: boolean
  html_storage_path: string
  pdf_storage_path: string | null
  fecha_actualizacion: string | null
  updated_at: string
}

async function requireAdmin(): Promise<string | null> {
  const { role, workspaceId, error } = await getWorkspace()
  if (error || role !== 'owner' || workspaceId !== process.env.ADMIN_WORKSPACE_ID) {
    return 'forbidden'
  }
  return null
}

export async function listWorkflows(): Promise<WorkflowRow[]> {
  const err = await requireAdmin()
  if (err) return []
  const svc = createServiceClient()
  // admin_workflows not in generated types yet — migration 20260422000001
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await ((svc as any).from('admin_workflows'))
    .select('*')
    .order('cliente_slug', { ascending: true })
    .order('proyecto_slug', { ascending: true })
    .order('linea_negocio', { ascending: true })
    .order('version', { ascending: false })
  if (error) return []
  return (data ?? []) as WorkflowRow[]
}

export async function getWorkflow(id: string): Promise<WorkflowRow | null> {
  const err = await requireAdmin()
  if (err) return null
  const svc = createServiceClient()
  // admin_workflows not in generated types yet — migration 20260422000001
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await ((svc as any).from('admin_workflows'))
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return data as WorkflowRow
}

export async function getHtmlSignedUrl(workflowId: string): Promise<string | null> {
  const err = await requireAdmin()
  if (err) return null
  const wf = await getWorkflow(workflowId)
  if (!wf) return null
  const svc = createServiceClient()
  const { data, error } = await svc.storage
    .from('workflows')
    .createSignedUrl(wf.html_storage_path, SIGNED_URL_TTL)
  if (error || !data) return null
  return data.signedUrl
}

export async function getPdfSignedUrl(workflowId: string): Promise<string | null> {
  const err = await requireAdmin()
  if (err) return null
  const wf = await getWorkflow(workflowId)
  if (!wf || !wf.pdf_storage_path) return null
  const svc = createServiceClient()
  const { data, error } = await svc.storage
    .from('workflows')
    .createSignedUrl(wf.pdf_storage_path, SIGNED_URL_TTL, { download: true })
  if (error || !data) return null
  return data.signedUrl
}
