'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import { revalidatePath } from 'next/cache'
import { todayBogotaISO } from '@/lib/dates/bogota'
import type { Database } from '@/types/database'
import {
  proponerCentroCostos,
  registrarMapeoAutomatico,
  type CentroCostos,
  type OrigenAsignacion,
} from '@/lib/actions/centro-costos-asignar'
import { negocioCerrado, MENSAJE_NEGOCIO_CERRADO } from '@/lib/negocios/motivo-cierre'
import { clasificarGastoConIA } from '@/lib/gastos/clasificar-gasto-ia'
import type { PropuestaGasto } from '@/lib/gastos/clasificar-gasto'
import { subirAOne } from '@/lib/almacenamiento/one'
import { BUCKET_SOPORTES_GASTO, extensionSegura, rutaEnWorkspace } from '@/lib/almacenamiento/referencia'

// ── Upload soporte to Storage ────────────────────────────────

export async function uploadSoporteGasto(formData: FormData) {
  const { workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado', url: null }
  // Gastos son de Clarity: un workspace sin ese módulo no sube soportes ni crea gastos.
  if (!(await exigirModulo(REQUISITO.clarity)).ok) return { success: false, error: MENSAJE_MODULO_NO_ACTIVO, url: null }

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { success: false, error: 'Sin archivo', url: null }

  const MAX_SIZE = 20 * 1024 * 1024 // 20MB
  if (file.size > MAX_SIZE) return { success: false, error: 'El archivo supera 20MB', url: null }

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  if (!allowed.includes(file.type)) return { success: false, error: 'Solo JPEG, PNG, WebP o PDF', url: null }

  const ext = extensionSegura(file.name.split('.').pop() ?? '') || 'jpg'
  const fileId = crypto.randomUUID()

  // Lo que se guarda en `gastos.soporte_url` es la REFERENCIA, no una URL pública: el
  // bucket deja de ser público y una URL de `object/public` se vuelve un enlace muerto.
  // Quien la abra pasa por `/api/archivos/abrir`, que valida sesión y workspace.
  try {
    const { referencia } = await subirAOne({
      bucket: BUCKET_SOPORTES_GASTO,
      path: rutaEnWorkspace(workspaceId, `${fileId}.${ext}`),
      cuerpo: file,
      mime: file.type,
    })
    return { success: true, error: null, url: referencia }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e), url: null }
  }
}

// ── Create gasto (FAB) ──────────────────────────────────────

export async function createGasto(input: {
  monto: number
  categoria: string
  clasificacion_costo?: 'variable' | 'fijo' | 'no_operativo'
  retencion?: number
  fecha: string
  descripcion?: string
  destino_id?: string | null  // UUID or 'empresa'
  destino_tipo?: 'negocio' | 'proyecto' | 'empresa'
  proyecto_id?: string | null  // legacy compat
  rubro_id?: string | null
  estado_pago?: 'pagado' | 'pendiente'
  soporte_url?: string | null
  // Centro de costos (opcional para no romper callers existentes)
  centro_costos?: CentroCostos | null
  split_json?: Record<string, number> | null
  origen_asignacion?: OrigenAsignacion | null
}) {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  if (!(await exigirModulo(REQUISITO.clarity)).ok) return { success: false, error: MENSAJE_MODULO_NO_ACTIVO }

  if (!input.monto || input.monto <= 0) return { success: false, error: 'Monto invalido' }

  // Validacion: comision requiere negocio_id (regla Carmen+Santiago 2026-04-26)
  if (input.categoria === 'comision' && input.destino_tipo !== 'negocio') {
    return { success: false, error: 'Las comisiones deben asignarse a un negocio especifico' }
  }

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
    const { data: negocio } = await supabase
      .from('negocios')
      .select('estado')
      .eq('id', destinoId)
      .single()

    if (!negocio) return { success: false, error: 'Negocio no encontrado' }
    // Los tres estados de cierre, no solo `completado`. Mismo hueco que en horas:
    // se alcanza con el negocio prellenado desde la URL (FAB en contexto).
    if (negocioCerrado(negocio.estado)) {
      return { success: false, error: MENSAJE_NEGOCIO_CERRADO }
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

  // Si centro_costos = directa_negocio y trae split_json (mixta), ignorar split_json.
  // Si centro_costos = mixta, el negocio_id queda null (el split tiene el desglose).
  const centroCostosFinal: CentroCostos | null = input.centro_costos ?? null
  let splitJsonFinal: Record<string, number> | null = null
  let origenFinal: OrigenAsignacion | null = input.origen_asignacion ?? null

  if (centroCostosFinal === 'mixta') {
    splitJsonFinal = input.split_json ?? null
    if (!splitJsonFinal) {
      return { success: false, error: 'Gasto mixto requiere desglose (split)' }
    }
    // Validar suma ≈ 1.0
    const suma = Object.values(splitJsonFinal).reduce((s, v) => s + Number(v || 0), 0)
    if (Math.abs(suma - 1) > 0.01) {
      return { success: false, error: `Split debe sumar 100% (suma actual: ${(suma * 100).toFixed(1)}%)` }
    }
    origenFinal = 'split'
  } else if (centroCostosFinal === 'directa_negocio') {
    if (!negocioId) {
      return { success: false, error: 'centro_costos directa_negocio requiere un negocio asignado' }
    }
  }

  const insertData: Database['public']['Tables']['gastos']['Insert'] = {
    workspace_id: workspaceId,
    fecha: input.fecha || todayBogotaISO(),
    monto: input.monto,
    categoria: input.categoria || 'otros',
    clasificacion_costo: input.clasificacion_costo ?? 'variable',
    retencion: input.retencion ?? 0,
    descripcion: input.descripcion?.trim() || null,
    deducible: false,
    proyecto_id: proyectoId,
    rubro_id: (proyectoId && input.rubro_id) ? input.rubro_id : null,
    tipo,
    estado_pago: input.estado_pago ?? 'pagado',
    soporte_url: input.soporte_url ?? null,
    canal_registro: 'app',
    created_by: userId,
    negocio_id: negocioId,
    centro_costos: centroCostosFinal,
    split_json: splitJsonFinal,
    origen_asignacion: origenFinal,
  }

  const { data: gastoInserted, error: dbError } = await supabase
    .from('gastos')
    .insert(insertData)
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  // Self-learning post-insert (best-effort, no rompe el flujo si falla)
  if (gastoInserted?.id && origenFinal === 'manual') {
    try {
      await registrarMapeoAutomatico(gastoInserted.id as string)
    } catch (e) {
      console.error('[centro-costos] self-learning falló:', e)
    }
  }

  revalidatePath('/numeros')
  if (proyectoId) revalidatePath(`/proyectos/${proyectoId}`)
  if (negocioId) revalidatePath(`/negocios/${negocioId}`)
  return { success: true }
}

// ── Server action: proponer centro de costos (para form) ────

export async function proponerCentroCostosAction(args: {
  descripcion?: string | null
}) {
  const { workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId || !(await exigirModulo(REQUISITO.clarity)).ok) {
    return {
      centro: null,
      origen: null,
      confianza: 0,
      sugerido_negocio_id: null,
      razon: 'no_auth',
    }
  }

  const propuesta = await proponerCentroCostos({
    workspaceId,
    descripcion: args.descripcion,
    userId: userId ?? null,
    // Sin contexto bot en este path (form web)
  })

  return propuesta
}

// ── Get active negocios + projects for gasto selector ────────

export async function getDestinosParaGasto() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { negocios: [] as { id: string; nombre: string; codigo: string }[], proyectos: [] as { id: string; nombre: string; tipo: string; codigo: string }[] }


  const [negociosRes, proyectosRes] = await Promise.all([
    supabase
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
    negocios: (negociosRes.data ?? []).map(n => ({
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

/**
 * Propone categoría y clasificación a partir de la descripción, para que el registro
 * no tenga que preguntarlas. La propuesta se muestra y se cambia en un clic: aquí no
 * se decide nada, se sugiere.
 */
export async function clasificarGastoAction(
  descripcion: string,
): Promise<PropuestaGasto | null> {
  const { workspaceId } = await getWorkspace()
  if (!workspaceId) return null
  // La clasificación la paga MeTRIK (Gemini con su llave): solo para quien registra gastos.
  if (!(await exigirModulo(REQUISITO.clarity)).ok) return null
  return clasificarGastoConIA(descripcion)
}
