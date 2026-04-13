'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { revalidatePath } from 'next/cache'
import { addHoras } from '../../proyectos/actions-v2'

export { addHoras }

// ── Get destinos (negocios + proyectos) for horas selector ──

export async function getDestinosParaHoras() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { negocios: [], proyectos: [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [negociosRes, proyectosRes] = await Promise.all([
    (supabase as any)
      .from('negocios')
      .select('id, nombre, codigo')
      .eq('workspace_id', workspaceId)
      .eq('estado', 'abierto')
      .order('nombre'),
    supabase
      .from('proyectos')
      .select('id, nombre, tipo, codigo')
      .eq('workspace_id', workspaceId)
      .eq('estado', 'en_ejecucion')
      .order('nombre'),
  ])

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    negocios: (negociosRes.data ?? []).map((n: any) => ({
      id: n.id as string,
      nombre: (n.nombre as string) ?? 'Sin nombre',
      codigo: (n.codigo as string) ?? '',
    })),
    proyectos: (proyectosRes.data ?? []).map((p: { id: string; nombre: string | null; tipo: string | null; codigo: string | null }) => ({
      id: p.id,
      nombre: p.nombre ?? 'Sin nombre',
      tipo: p.tipo ?? 'cliente',
      codigo: p.codigo ?? '',
    })),
  }
}

// ── Get active projects for horas selector (deprecated — use getDestinosParaHoras) ──

export async function getProyectosParaHoras() {
  const destinos = await getDestinosParaHoras()
  return destinos.proyectos
}

// ── Register horas on negocio or proyecto ───────────────────

export async function addHorasDestino(
  destinoId: string,
  destinoTipo: 'negocio' | 'proyecto',
  input: {
    fecha: string
    horas: number
    descripcion?: string
    staff_id?: string
  },
): Promise<{ success: true } | { success: false; error: string }> {
  // Proyecto path: delegate to existing addHoras
  if (destinoTipo === 'proyecto') {
    return addHoras(destinoId, input)
  }

  // Negocio path
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Validate negocio exists and is active
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negocio } = await (supabase as any)
    .from('negocios')
    .select('estado')
    .eq('id', destinoId)
    .single()

  if (!negocio) return { success: false, error: 'Negocio no encontrado' }
  if (negocio.estado === 'completado') {
    return { success: false, error: 'No se pueden registrar horas en negocios completados' }
  }

  // If no staff_id provided, default to principal staff
  let staffId = input.staff_id
  if (!staffId) {
    const { data: principal } = await supabase
      .from('staff')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('es_principal', true)
      .eq('is_active', true)
      .limit(1)
      .single()
    staffId = principal?.id ?? undefined
  }

  // Auto-approve for owner/admin
  const perms = getRolePermissions(role ?? 'read_only')
  const autoApprove = perms.canApproveCausacion

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertData: any = {
    workspace_id: workspaceId,
    negocio_id: destinoId,
    proyecto_id: null,
    fecha: input.fecha,
    horas: input.horas,
    descripcion: input.descripcion?.trim() || null,
    staff_id: staffId || null,
    created_by: userId,
    estado_aprobacion: autoApprove ? 'APROBADO' : 'PENDIENTE',
    aprobado_por: autoApprove ? userId : null,
    fecha_aprobacion: autoApprove ? new Date().toISOString() : null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await (supabase as any)
    .from('horas')
    .insert(insertData)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/negocios')
  revalidatePath('/equipo')
  return { success: true }
}

// ── Get active staff for horas selector ──────────────────────

export async function getStaffActivo() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('staff')
    .select('id, full_name, tipo_vinculo, es_principal')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('es_principal', { ascending: false })
    .order('full_name')

  return (data ?? []).map(s => ({
    id: s.id,
    full_name: s.full_name ?? 'Sin nombre',
    tipo_vinculo: s.tipo_vinculo,
    es_principal: s.es_principal,
  }))
}
