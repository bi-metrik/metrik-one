'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ── Upload soporte to Storage ────────────────────────────────

export async function uploadSoporteGasto(formData: FormData) {
  const { workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado', url: null }

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { success: false, error: 'Sin archivo', url: null }

  const MAX_SIZE = 20 * 1024 * 1024 // 20MB
  if (file.size > MAX_SIZE) return { success: false, error: 'El archivo supera 20MB', url: null }

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  if (!allowed.includes(file.type)) return { success: false, error: 'Solo JPEG, PNG, WebP o PDF', url: null }

  const ext = file.name.split('.').pop() || 'jpg'
  const fileId = crypto.randomUUID()
  const filePath = `${workspaceId}/${fileId}.${ext}`

  const admin = createServiceClient()
  const { error: uploadError } = await admin.storage
    .from('gastos-soportes')
    .upload(filePath, file, { contentType: file.type, upsert: true })

  if (uploadError) return { success: false, error: uploadError.message, url: null }

  const { data: { publicUrl } } = admin.storage
    .from('gastos-soportes')
    .getPublicUrl(filePath)

  return { success: true, error: null, url: publicUrl }
}

// ── Create gasto (FAB) ──────────────────────────────────────

export async function createGasto(input: {
  monto: number
  categoria: string
  fecha: string
  descripcion?: string
  destino_id?: string | null  // UUID or 'empresa'
  destino_tipo?: 'negocio' | 'proyecto' | 'empresa'
  proyecto_id?: string | null  // legacy compat
  rubro_id?: string | null
  estado_pago?: 'pagado' | 'pendiente'
  soporte_url?: string | null
}) {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  if (!input.monto || input.monto <= 0) return { success: false, error: 'Monto invalido' }

  // Determine tipo, proyecto_id, negocio_id
  let tipo: string = 'operativo'
  let proyectoId: string | null = null
  let negocioId: string | null = null

  const destinoId = input.destino_id ?? input.proyecto_id
  const destinoTipo = input.destino_tipo ?? (input.proyecto_id ? 'proyecto' : undefined)

  if (destinoId === 'empresa' || !destinoId) {
    tipo = 'empresa'
  } else if (destinoTipo === 'negocio') {
    // Validate negocio is activo
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: negocio } = await (supabase as any)
      .from('negocios')
      .select('estado')
      .eq('id', destinoId)
      .single()

    if (!negocio) return { success: false, error: 'Negocio no encontrado' }
    if ((negocio as any).estado !== 'activo') {
      return { success: false, error: 'Solo se pueden registrar gastos en negocios activos' }
    }

    tipo = 'directo'
    negocioId = destinoId
  } else {
    // Legacy: proyecto
    const { data: proyecto } = await supabase
      .from('proyectos')
      .select('estado')
      .eq('id', destinoId)
      .single()

    if (!proyecto) return { success: false, error: 'Proyecto no encontrado' }
    if (proyecto.estado !== 'en_ejecucion') {
      return { success: false, error: 'Solo se pueden registrar gastos en proyectos en ejecución' }
    }

    tipo = 'directo'
    proyectoId = destinoId
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertData: Record<string, any> = {
    workspace_id: workspaceId,
    fecha: input.fecha || new Date().toISOString().split('T')[0],
    monto: input.monto,
    categoria: input.categoria || 'otros',
    descripcion: input.descripcion?.trim() || null,
    deducible: false,
    proyecto_id: proyectoId,
    rubro_id: (proyectoId && input.rubro_id) ? input.rubro_id : null,
    tipo,
    estado_pago: input.estado_pago ?? 'pagado',
    soporte_url: input.soporte_url ?? null,
    canal_registro: 'app',
    created_by: userId,
  }
  if (negocioId) insertData.negocio_id = negocioId

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: dbError } = await supabase
    .from('gastos')
    .insert(insertData as any)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/numeros')
  if (proyectoId) revalidatePath(`/proyectos/${proyectoId}`)
  if (negocioId) revalidatePath(`/negocios/${negocioId}`)
  return { success: true }
}

// ── Get active negocios + projects for gasto selector ────────

export async function getDestinosParaGasto() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { negocios: [] as { id: string; nombre: string; codigo: string }[], proyectos: [] as { id: string; nombre: string; tipo: string; codigo: string }[] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [negociosRes, proyectosRes] = await Promise.all([
    (supabase as any)
      .from('negocios')
      .select('id, nombre, codigo')
      .eq('workspace_id', workspaceId)
      .eq('estado', 'activo')
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
      id: n.id,
      nombre: n.nombre ?? 'Sin nombre',
      codigo: n.codigo ?? '',
    })),
    proyectos: (proyectosRes.data ?? []).map(p => ({
      id: p.id,
      nombre: p.nombre ?? 'Sin nombre',
      tipo: p.tipo ?? 'cliente',
      codigo: p.codigo ?? '',
    })),
  }
}

/** @deprecated Use getDestinosParaGasto instead */
export async function getProyectosParaGasto() {
  const result = await getDestinosParaGasto()
  return result.proyectos
}

// ── Get rubros for a specific project ────────────────────────

export async function getRubrosProyecto(proyectoId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  const { data } = await supabase
    .from('proyecto_rubros')
    .select('id, nombre, tipo')
    .eq('proyecto_id', proyectoId)
    .order('created_at')

  return data ?? []
}
