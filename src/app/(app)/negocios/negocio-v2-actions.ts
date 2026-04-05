'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

// ── Tipos inline para el nuevo schema de negocios ─────────────────────────────
// Las tablas nuevas (negocios, lineas_negocio, etapas_negocio, bloque_configs,
// bloque_definitions, negocio_bloques, bloque_items) aún no están en database.ts.
// Usar tipos inline. El cliente Supabase se castea via `db()` para evitar el error
// "Type instantiation is excessively deep" al acceder a tablas desconocidas.

export type LineaNegocio = {
  id: string
  workspace_id: string | null
  nombre: string
  tipo: 'plantilla' | 'clarity'
}

export type EtapaNegocio = {
  id: string
  linea_id: string
  stage: 'venta' | 'ejecucion' | 'cobro'
  nombre: string
  orden: number
}

export type BloqueDefinition = {
  id: string
  tipo: string
  nombre: string
  is_visualization: boolean
  can_be_gate: boolean
}

export type BloqueConfig = {
  id: string
  etapa_id: string
  workspace_id: string
  bloque_definition_id: string
  estado: 'editable' | 'visible'
  orden: number
  es_gate: boolean
  bloque_definitions: BloqueDefinition | null
}

export type NegocioBloque = {
  id: string
  negocio_id: string
  bloque_config_id: string
  estado: 'pendiente' | 'completo'
  data: Record<string, unknown> | null
}

export type NegocioDetalle = {
  id: string
  workspace_id: string
  linea_id: string | null
  empresa_id: string | null
  contacto_id: string | null
  nombre: string
  precio_estimado: number | null
  precio_aprobado: number | null
  carpeta_url: string | null
  stage_actual: 'venta' | 'ejecucion' | 'cobro' | null
  etapa_actual_id: string | null
  estado: string | null
  tipo_cierre: string | null
  motivo_cierre: string | null
  lecciones_aprendidas: string | null
  balance_final: number | null
  created_at: string | null
  updated_at: string | null
  closed_at: string | null
  // Joins — usando columnas reales de las tablas existentes (empresas.nombre, contactos.nombre)
  lineas_negocio: { nombre: string } | null
  etapas_negocio: { nombre: string; stage: string } | null
  empresas: { nombre: string } | null
  contactos: { nombre: string } | null
}

export type NegocioResumen = {
  id: string
  nombre: string
  precio_estimado: number | null
  precio_aprobado: number | null
  carpeta_url: string | null
  stage_actual: 'venta' | 'ejecucion' | 'cobro' | null
  estado: string | null
  created_at: string | null
  // Joins
  linea_nombre: string | null
  etapa_nombre: string | null
  etapa_stage: string | null
  empresa_nombre: string | null
  contacto_nombre: string | null
}

// Helper: cast Supabase client a untyped para tablas nuevas no en database.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

// ── Listar negocios del workspace ─────────────────────────────────────────────

export async function getNegociosV2(): Promise<NegocioResumen[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await db(supabase)
    .from('negocios')
    .select(`
      id,
      nombre,
      precio_estimado,
      precio_aprobado,
      carpeta_url,
      stage_actual,
      estado,
      created_at,
      lineas_negocio(nombre),
      etapas_negocio(nombre, stage),
      empresas(nombre),
      contactos(nombre)
    `)
    .eq('workspace_id', workspaceId)
    .eq('estado', 'activo')
    .order('created_at', { ascending: false })

  if (!data) return []

  return (data as Record<string, unknown>[]).map(row => ({
    id: row.id as string,
    nombre: row.nombre as string,
    precio_estimado: row.precio_estimado as number | null,
    precio_aprobado: row.precio_aprobado as number | null,
    carpeta_url: row.carpeta_url as string | null,
    stage_actual: row.stage_actual as 'venta' | 'ejecucion' | 'cobro' | null,
    estado: row.estado as string | null,
    created_at: row.created_at as string | null,
    linea_nombre: (row.lineas_negocio as { nombre: string } | null)?.nombre ?? null,
    etapa_nombre: (row.etapas_negocio as { nombre: string; stage: string } | null)?.nombre ?? null,
    etapa_stage: (row.etapas_negocio as { nombre: string; stage: string } | null)?.stage ?? null,
    empresa_nombre: (row.empresas as { nombre: string } | null)?.nombre ?? null,
    contacto_nombre: (row.contactos as { nombre: string } | null)?.nombre ?? null,
  }))
}

// ── Detalle de un negocio ─────────────────────────────────────────────────────

export async function getNegocioDetalle(id: string): Promise<{
  negocio: NegocioDetalle
  bloques: Array<BloqueConfig & { instancia: NegocioBloque | null }>
  etapasLinea: EtapaNegocio[]
} | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select(`
      id,
      workspace_id,
      linea_id,
      empresa_id,
      contacto_id,
      nombre,
      precio_estimado,
      precio_aprobado,
      carpeta_url,
      stage_actual,
      etapa_actual_id,
      estado,
      tipo_cierre,
      motivo_cierre,
      lecciones_aprendidas,
      balance_final,
      created_at,
      updated_at,
      closed_at,
      lineas_negocio(nombre),
      etapas_negocio(nombre, stage),
      empresas(nombre),
      contactos(nombre)
    `)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single()

  if (!negocio) return null

  const negocioTyped = negocio as NegocioDetalle

  // Cargar etapas de la línea para la barra de progreso
  let etapasLinea: EtapaNegocio[] = []
  if (negocioTyped.linea_id) {
    const { data: etapas } = await db(supabase)
      .from('etapas_negocio')
      .select('id, linea_id, stage, nombre, orden')
      .eq('linea_id', negocioTyped.linea_id)
      .order('orden', { ascending: true })

    etapasLinea = ((etapas ?? []) as Record<string, unknown>[]).map(e => ({
      id: e.id as string,
      linea_id: e.linea_id as string,
      stage: e.stage as 'venta' | 'ejecucion' | 'cobro',
      nombre: e.nombre as string,
      orden: e.orden as number,
    }))
  }

  // Cargar bloque_configs de la etapa actual + negocio_bloques correspondientes
  let bloques: Array<BloqueConfig & { instancia: NegocioBloque | null }> = []
  if (negocioTyped.etapa_actual_id) {
    const { data: bloqueConfigs } = await db(supabase)
      .from('bloque_configs')
      .select(`
        id,
        etapa_id,
        workspace_id,
        bloque_definition_id,
        estado,
        orden,
        es_gate,
        bloque_definitions(id, tipo, nombre, is_visualization, can_be_gate)
      `)
      .eq('etapa_id', negocioTyped.etapa_actual_id)
      .eq('workspace_id', workspaceId)
      .order('orden', { ascending: true })

    // Cargar instancias runtime
    const configIds = ((bloqueConfigs ?? []) as Record<string, unknown>[]).map(b => b.id as string)
    const instanciasMap: Record<string, NegocioBloque> = {}

    if (configIds.length > 0) {
      const { data: instancias } = await db(supabase)
        .from('negocio_bloques')
        .select('id, negocio_id, bloque_config_id, estado, data')
        .eq('negocio_id', id)
        .in('bloque_config_id', configIds)

      for (const inst of ((instancias ?? []) as Record<string, unknown>[])) {
        instanciasMap[inst.bloque_config_id as string] = inst as unknown as NegocioBloque
      }
    }

    bloques = ((bloqueConfigs ?? []) as Record<string, unknown>[]).map(bc => ({
      id: bc.id as string,
      etapa_id: bc.etapa_id as string,
      workspace_id: bc.workspace_id as string,
      bloque_definition_id: bc.bloque_definition_id as string,
      estado: bc.estado as 'editable' | 'visible',
      orden: bc.orden as number,
      es_gate: bc.es_gate as boolean,
      bloque_definitions: bc.bloque_definitions as BloqueDefinition | null,
      instancia: instanciasMap[bc.id as string] ?? null,
    }))
  }

  return { negocio: negocioTyped, bloques, etapasLinea }
}

// ── Datos para formulario de creación ────────────────────────────────────────

export async function getDatosNuevoNegocio(): Promise<{
  empresas: { id: string; nombre: string }[]
  contactos: { id: string; nombre: string }[]
  lineas: LineaNegocio[]
}> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { empresas: [], contactos: [], lineas: [] }

  const [empresasRes, contactosRes, lineasRes] = await Promise.all([
    supabase
      .from('empresas')
      .select('id, nombre')
      .eq('workspace_id', workspaceId)
      .order('nombre', { ascending: true }),
    supabase
      .from('contactos')
      .select('id, nombre')
      .eq('workspace_id', workspaceId)
      .order('nombre', { ascending: true }),
    db(supabase)
      .from('lineas_negocio')
      .select('id, workspace_id, nombre, tipo')
      .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
      .order('nombre', { ascending: true }),
  ])

  return {
    empresas: (empresasRes.data ?? []) as { id: string; nombre: string }[],
    contactos: (contactosRes.data ?? []) as { id: string; nombre: string }[],
    lineas: ((lineasRes.data ?? []) as Record<string, unknown>[]).map(l => ({
      id: l.id as string,
      workspace_id: l.workspace_id as string | null,
      nombre: l.nombre as string,
      tipo: l.tipo as 'plantilla' | 'clarity',
    })),
  }
}

// ── Crear negocio ─────────────────────────────────────────────────────────────

export async function crearNegocio(input: {
  nombre: string
  linea_id: string
  empresa_id?: string
  contacto_id?: string
  precio_estimado?: number
}): Promise<{ negocio_id: string | null; error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { negocio_id: null, error: 'No autenticado' }

  // Obtener primera etapa de la línea seleccionada
  const { data: primeraEtapaRaw } = await db(supabase)
    .from('etapas_negocio')
    .select('id, stage')
    .eq('linea_id', input.linea_id)
    .order('orden', { ascending: true })
    .limit(1)
    .single()

  const primeraEtapa = primeraEtapaRaw as { id: string; stage: string } | null

  const { data: negocio, error: insertError } = await db(supabase)
    .from('negocios')
    .insert({
      workspace_id: workspaceId,
      nombre: input.nombre,
      linea_id: input.linea_id,
      empresa_id: input.empresa_id ?? null,
      contacto_id: input.contacto_id ?? null,
      precio_estimado: input.precio_estimado ?? null,
      etapa_actual_id: primeraEtapa?.id ?? null,
      stage_actual: primeraEtapa?.stage ?? null,
      estado: 'activo',
    })
    .select('id')
    .single()

  if (insertError || !negocio) {
    return { negocio_id: null, error: (insertError as { message: string })?.message ?? 'Error al crear negocio' }
  }

  const negocioData = negocio as { id: string }

  // Crear negocio_bloques para cada bloque_config de la primera etapa
  if (primeraEtapa?.id) {
    const { data: bloqueConfigs } = await db(supabase)
      .from('bloque_configs')
      .select('id')
      .eq('etapa_id', primeraEtapa.id)
      .eq('workspace_id', workspaceId)

    if (bloqueConfigs && (bloqueConfigs as Record<string, unknown>[]).length > 0) {
      const instancias = (bloqueConfigs as Record<string, unknown>[]).map(bc => ({
        negocio_id: negocioData.id,
        bloque_config_id: bc.id as string,
        estado: 'pendiente',
        data: null,
      }))

      await db(supabase).from('negocio_bloques').insert(instancias)
    }
  }

  revalidatePath('/negocios')
  return { negocio_id: negocioData.id, error: null }
}

// ── Cambiar etapa del negocio ─────────────────────────────────────────────────

export async function cambiarEtapaNegocio(
  negocioId: string,
  nuevaEtapaId: string
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const { data: etapaRaw } = await db(supabase)
    .from('etapas_negocio')
    .select('id, stage')
    .eq('id', nuevaEtapaId)
    .single()

  const etapa = etapaRaw as { id: string; stage: string } | null
  if (!etapa) return { error: 'Etapa no encontrada' }

  const { error: updateError } = await db(supabase)
    .from('negocios')
    .update({
      etapa_actual_id: nuevaEtapaId,
      stage_actual: etapa.stage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updateError) return { error: (updateError as { message: string }).message }

  // Crear negocio_bloques para la nueva etapa si no existen
  const { data: bloqueConfigs } = await db(supabase)
    .from('bloque_configs')
    .select('id')
    .eq('etapa_id', nuevaEtapaId)
    .eq('workspace_id', workspaceId)

  if (bloqueConfigs && (bloqueConfigs as Record<string, unknown>[]).length > 0) {
    const configIds = (bloqueConfigs as Record<string, unknown>[]).map(b => b.id as string)

    const instanciasExistentes = await db(supabase)
      .from('negocio_bloques')
      .select('bloque_config_id')
      .eq('negocio_id', negocioId)
      .in('bloque_config_id', configIds)

    const existingIds = new Set(
      ((instanciasExistentes.data ?? []) as Record<string, unknown>[]).map(
        i => i.bloque_config_id as string
      )
    )

    const nuevas = (bloqueConfigs as Record<string, unknown>[])
      .filter(bc => !existingIds.has(bc.id as string))
      .map(bc => ({
        negocio_id: negocioId,
        bloque_config_id: bc.id as string,
        estado: 'pendiente',
        data: null,
      }))

    if (nuevas.length > 0) {
      await db(supabase).from('negocio_bloques').insert(nuevas)
    }
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null }
}
