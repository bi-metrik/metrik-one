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

// ── Cambiar etapa con gate check ──────────────────────────────────────────────

export async function cambiarEtapaNegocioConGate(
  negocioId: string,
  nuevaEtapaId: string,
  motivoOverride?: string
): Promise<{
  error: string | null
  bloquesPendientes?: Array<{ nombre: string; es_gate: boolean }>
}> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Obtener etapa actual del negocio
  const { data: negocioRaw } = await db(supabase)
    .from('negocios')
    .select('etapa_actual_id')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  const negocio = negocioRaw as { etapa_actual_id: string | null } | null
  if (!negocio) return { error: 'Negocio no encontrado' }

  // Validar que la nueva etapa es la siguiente en orden estricto
  if (negocio.etapa_actual_id) {
    const [etapaActualRes, nuevaEtapaRes] = await Promise.all([
      db(supabase)
        .from('etapas_negocio')
        .select('orden, linea_id')
        .eq('id', negocio.etapa_actual_id)
        .single(),
      db(supabase)
        .from('etapas_negocio')
        .select('orden, linea_id')
        .eq('id', nuevaEtapaId)
        .single(),
    ])

    const etapaActualData = etapaActualRes.data as { orden: number; linea_id: string } | null
    const nuevaEtapaData = nuevaEtapaRes.data as { orden: number; linea_id: string } | null

    if (!etapaActualData || !nuevaEtapaData) return { error: 'Etapa no encontrada' }
    if (etapaActualData.linea_id !== nuevaEtapaData.linea_id) return { error: 'Etapas de líneas distintas' }
    if (nuevaEtapaData.orden !== etapaActualData.orden + 1) {
      return { error: 'Solo puedes avanzar a la siguiente etapa en orden' }
    }
  }

  // Verificar gates si no hay motivo de override
  if (!motivoOverride && negocio.etapa_actual_id) {
    const { data: puedeAvanzar } = await db(supabase)
      .rpc('puede_avanzar_etapa', {
        p_negocio_id: negocioId,
        p_etapa_id: negocio.etapa_actual_id,
      })

    if (!puedeAvanzar) {
      // Devolver lista de bloques gate pendientes
      const { data: bloquesPendientesRaw } = await db(supabase)
        .from('bloque_configs')
        .select(`
          es_gate,
          bloque_definitions(nombre)
        `)
        .eq('etapa_id', negocio.etapa_actual_id)
        .eq('workspace_id', workspaceId)
        .eq('es_gate', true)

      const configIds = ((bloquesPendientesRaw ?? []) as Record<string, unknown>[]).map(
        (b: Record<string, unknown>) => b.id as string
      )

      const bloquesPendientes = ((bloquesPendientesRaw ?? []) as Record<string, unknown>[]).map(
        (b: Record<string, unknown>) => ({
          nombre: ((b.bloque_definitions as { nombre: string } | null)?.nombre ?? 'Bloque'),
          es_gate: b.es_gate as boolean,
        })
      )

      return { error: 'gate_bloqueado', bloquesPendientes }
    }
  }

  // Si hay override: log del motivo en activity (simplificado por ahora)
  // En producción completa: insertar en activity_log con el motivo
  const resultCambio = await cambiarEtapaNegocio(negocioId, nuevaEtapaId)
  return resultCambio
}

// ── Marcar bloque completo ─────────────────────────────────────────────────────

export async function marcarBloqueCompleto(
  negocioBloqueId: string,
  data: Record<string, unknown>
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  const { error: updateError } = await db(supabase)
    .from('negocio_bloques')
    .update({
      estado: 'completo',
      data,
      completado_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', negocioBloqueId)

  if (updateError) return { error: (updateError as { message: string }).message }

  // ── Trigger auto-cobros si el bloque tiene esa configuración ─────────
  // Buscar el bloque_config y su config_extra para detectar el trigger
  const { data: bloqueRaw } = await db(supabase)
    .from('negocio_bloques')
    .select(`
      negocio_id,
      bloque_config_id,
      bloque_configs(
        config_extra,
        bloque_definitions(tipo)
      )
    `)
    .eq('id', negocioBloqueId)
    .single()

  if (bloqueRaw) {
    const bloque = bloqueRaw as {
      negocio_id: string
      bloque_config_id: string
      bloque_configs: {
        config_extra: Record<string, unknown>
        bloque_definitions: { tipo: string } | null
      } | null
    }

    const tipo = bloque.bloque_configs?.bloque_definitions?.tipo
    const configExtra = bloque.bloque_configs?.config_extra ?? {}
    const triggers = (configExtra.triggers ?? []) as Array<{ event: string; action: string; params?: Record<string, unknown> }>

    const autoCobros = triggers.find(t => t.action === 'auto_cobros')
    if (tipo === 'datos' && autoCobros) {
      const valorAnticipo = data.valor_anticipo as number | undefined
      if (valorAnticipo) {
        await autoCrearCobros(bloque.negocio_id, valorAnticipo)
      }
    }
  }

  return { error: null }
}

// ── Actualizar data del bloque sin marcar completo ────────────────────────────

export async function actualizarBloqueData(
  negocioBloqueId: string,
  data: Record<string, unknown>
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  const { error: updateError } = await db(supabase)
    .from('negocio_bloques')
    .update({
      data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', negocioBloqueId)

  if (updateError) return { error: (updateError as { message: string }).message }
  return { error: null }
}

// ── Inicializar bloque_items desde templates ─────────────────────────────────
// Llamar en primer render de BloqueChecklist cuando initialItems está vacío

export async function inicializarBloqueItems(
  negocioBloqueId: string,
  templates: Array<{ label: string; tipo: string }>
): Promise<{
  items: Array<{ id: string; label: string; tipo: string; completado: boolean; completado_por: string | null; completado_at: string | null; link_url: string | null }>
  error: string | null
}> {
  const { supabase, error } = await getWorkspace()
  if (error) return { items: [], error: 'No autenticado' }

  // Verificar si ya existen items
  const { data: existentes } = await db(supabase)
    .from('bloque_items')
    .select('id')
    .eq('negocio_bloque_id', negocioBloqueId)
    .limit(1)

  if (existentes && (existentes as unknown[]).length > 0) {
    // Ya existen — devolver todos
    const { data: allItems } = await db(supabase)
      .from('bloque_items')
      .select('id, label, tipo, completado, completado_por, completado_at, link_url')
      .eq('negocio_bloque_id', negocioBloqueId)
      .order('orden', { ascending: true })

    return {
      items: ((allItems ?? []) as Record<string, unknown>[]).map(i => ({
        id: i.id as string,
        label: i.label as string,
        tipo: i.tipo as string,
        completado: i.completado as boolean,
        completado_por: i.completado_por as string | null,
        completado_at: i.completado_at as string | null,
        link_url: i.link_url as string | null,
      })),
      error: null,
    }
  }

  // Crear items desde templates
  const rows = templates.map((t, i) => ({
    negocio_bloque_id: negocioBloqueId,
    label: t.label,
    tipo: t.tipo === 'checkbox' ? 'checkbox' : 'texto',
    orden: i,
    completado: false,
    contenido: {},
  }))

  const { data: created, error: insertError } = await db(supabase)
    .from('bloque_items')
    .insert(rows)
    .select('id, label, tipo, completado, completado_por, completado_at, link_url')

  if (insertError) return { items: [], error: (insertError as { message: string }).message }

  return {
    items: ((created ?? []) as Record<string, unknown>[]).map(i => ({
      id: i.id as string,
      label: i.label as string,
      tipo: i.tipo as string,
      completado: i.completado as boolean,
      completado_por: i.completado_por as string | null,
      completado_at: i.completado_at as string | null,
      link_url: i.link_url as string | null,
    })),
    error: null,
  }
}

// ── Marcar ítem de checklist / cronograma ─────────────────────────────────────

export async function marcarBloqueItem(
  bloqueItemId: string,
  completado: boolean,
  linkUrl?: string
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  const payload: Record<string, unknown> = {
    completado,
    completado_at: completado ? new Date().toISOString() : null,
  }
  if (linkUrl !== undefined) payload.link_url = linkUrl

  const { error: updateError } = await db(supabase)
    .from('bloque_items')
    .update(payload)
    .eq('id', bloqueItemId)

  if (updateError) return { error: (updateError as { message: string }).message }
  return { error: null }
}

// ── Auto-crear cobros (anticipo + saldo) ──────────────────────────────────────

export async function autoCrearCobros(
  negocioId: string,
  valorAnticipo: number
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Obtener precio del negocio
  const { data: negocioRaw } = await db(supabase)
    .from('negocios')
    .select('precio_aprobado, precio_estimado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  const negocio = negocioRaw as { precio_aprobado: number | null; precio_estimado: number | null } | null
  if (!negocio) return { error: 'Negocio no encontrado' }

  const precioTotal = negocio.precio_aprobado ?? negocio.precio_estimado ?? 0
  const saldo = precioTotal - valorAnticipo

  const cobros = [
    {
      workspace_id: workspaceId,
      negocio_id: negocioId,
      concepto: 'Anticipo',
      monto: valorAnticipo,
      tipo_cobro: 'anticipo',
      estado_causacion: 'PENDIENTE',
      fecha: new Date().toISOString().split('T')[0],
      // Required by schema but irrelevant here; migration will make them nullable
      factura_id: null,
      proyecto_id: null,
    },
    {
      workspace_id: workspaceId,
      negocio_id: negocioId,
      concepto: 'Saldo',
      monto: saldo,
      tipo_cobro: 'saldo',
      estado_causacion: 'PENDIENTE',
      fecha: new Date().toISOString().split('T')[0],
      factura_id: null,
      proyecto_id: null,
    },
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (supabase as any).from('cobros').insert(cobros)
  if (insertError) return { error: (insertError as { message: string }).message }

  revalidatePath(`/negocios/${negocioId}`)
  return { error: null }
}

// ── Agregar un bloque_item (cronograma) ───────────────────────────────────────

export async function agregarBloqueItem(
  negocioBloqueId: string,
  label: string,
  tipo: string,
  orden: number
): Promise<{ id: string | null; error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { id: null, error: 'No autenticado' }

  const { data, error: insertError } = await db(supabase)
    .from('bloque_items')
    .insert({ negocio_bloque_id: negocioBloqueId, label, tipo, orden, completado: false, contenido: {} })
    .select('id')
    .single()

  if (insertError) return { id: null, error: (insertError as { message: string }).message }
  return { id: (data as { id: string }).id, error: null }
}

// ── Actualizar datos de un bloque_item ────────────────────────────────────────

export async function actualizarBloqueItem(
  bloqueItemId: string,
  fields: { label?: string; fecha_inicio?: string | null; fecha_fin?: string | null; link_url?: string | null }
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  const { error: updateError } = await db(supabase)
    .from('bloque_items')
    .update(fields)
    .eq('id', bloqueItemId)

  if (updateError) return { error: (updateError as { message: string }).message }
  return { error: null }
}

// ── Confirmar pago de cobro ───────────────────────────────────────────────────

export async function confirmarPagoCobro(
  cobroId: string,
  referencia?: string,
  valorParcial?: number
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const payload: Record<string, unknown> = {
    estado_causacion: 'APROBADO',
    notas: referencia ? `Ref: ${referencia}` : undefined,
  }
  if (valorParcial) payload.monto = valorParcial

  const { error: updateError } = await supabase
    .from('cobros')
    .update(payload)
    .eq('id', cobroId)
    .eq('workspace_id', workspaceId)

  if (updateError) return { error: (updateError as { message: string }).message }

  revalidatePath('/negocios')
  return { error: null }
}

// ── Actualizar aprobación de bloque ──────────────────────────────────────────

export async function actualizarAprobacion(
  negocioBloqueId: string,
  data: {
    aprobador_id?: string
    estado?: 'pendiente' | 'aprobado' | 'rechazado'
    comentario?: string
    aprobado_at?: string
  }
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  const isComplete = data.estado === 'aprobado'

  const payload: Record<string, unknown> = {
    data,
    updated_at: new Date().toISOString(),
  }
  if (isComplete) {
    payload.estado = 'completo'
    payload.completado_at = new Date().toISOString()
  }

  const { error: updateError } = await db(supabase)
    .from('negocio_bloques')
    .update(payload)
    .eq('id', negocioBloqueId)

  if (updateError) return { error: (updateError as { message: string }).message }
  return { error: null }
}

// ── Cargar datos completos para detalle con bloques ───────────────────────────

export async function getNegocioDetalleCompleto(id: string): Promise<{
  negocio: NegocioDetalle
  bloques: Array<BloqueConfig & {
    instancia: NegocioBloque | null
    config_extra: Record<string, unknown>
    items: Array<{
      id: string
      label: string
      tipo: string
      completado: boolean
      completado_por: string | null
      completado_at: string | null
      link_url: string | null
      imagen_data: string | null
      orden: number
    }>
  }>
  etapasLinea: EtapaNegocio[]
  profiles: Array<{ id: string; full_name: string | null; email: string | null }>
  cobros: Array<{
    id: string
    concepto: string | null
    monto: number
    estado_causacion: string
    tipo_cobro: string | null
    fecha: string | null
    notas: string | null
  }>
  cotizacion: {
    id: string
    consecutivo: string
    estado: string
    valor_total: number | null
    created_at: string
    oportunidad_id: string | null
  } | null
  resumenFinanciero: {
    totalCobrado: number
    porCobrar: number
    costosEjecutados: number
  }
} | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  // Cargar negocio base
  const base = await getNegocioDetalle(id)
  if (!base) return null

  // Cargar config_extra de los bloque_configs
  const bloqueConfigIds = base.bloques.map(b => b.id)
  let bloqueConfigsExtra: Record<string, Record<string, unknown>> = {}
  if (bloqueConfigIds.length > 0) {
    const { data: extras } = await db(supabase)
      .from('bloque_configs')
      .select('id, config_extra')
      .in('id', bloqueConfigIds)
    if (extras) {
      for (const e of extras as Record<string, unknown>[]) {
        bloqueConfigsExtra[e.id as string] = (e.config_extra ?? {}) as Record<string, unknown>
      }
    }
  }

  // Cargar bloque_items de todos los negocio_bloques
  const negocioBloqueIds = base.bloques.map(b => b.instancia?.id).filter(Boolean) as string[]
  let itemsByBloqueId: Record<string, unknown[]> = {}
  if (negocioBloqueIds.length > 0) {
    const { data: itemsData } = await db(supabase)
      .from('bloque_items')
      .select('id, negocio_bloque_id, label, tipo, completado, completado_por, completado_at, link_url, imagen_data, orden')
      .in('negocio_bloque_id', negocioBloqueIds)
      .order('orden', { ascending: true })
    if (itemsData) {
      for (const item of itemsData as Record<string, unknown>[]) {
        const bid = item.negocio_bloque_id as string
        if (!itemsByBloqueId[bid]) itemsByBloqueId[bid] = []
        itemsByBloqueId[bid].push(item)
      }
    }
  }

  // Cargar profiles del workspace
  const { data: profilesData } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('workspace_id', workspaceId)
    .order('full_name', { ascending: true })

  // Cargar cobros del negocio (db() para evitar type errors en columnas nuevas)
  const { data: cobrosData } = await db(supabase)
    .from('cobros')
    .select('id, notas, monto, estado_causacion, tipo_cobro, fecha')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', id)
    .order('created_at', { ascending: true })

  // Cargar cotizacion (buscar por negocio a través de oportunidad vinculada)
  // Por ahora: buscar en data del bloque cotizacion
  const cotizacionBloque = base.bloques.find(
    b => b.bloque_definitions?.tipo === 'cotizacion'
  )
  const cotizacionId = (cotizacionBloque?.instancia?.data as Record<string, unknown>)?.cotizacion_id as string | undefined
  let cotizacion = null
  if (cotizacionId) {
    const { data: cotData } = await supabase
      .from('cotizaciones')
      .select('id, consecutivo, estado, valor_total, created_at, oportunidad_id')
      .eq('id', cotizacionId)
      .single()
    cotizacion = cotData
  }

  // Calcular resumen financiero
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cobrosList = ((cobrosData ?? []) as any[]) as Array<{
    monto: number
    estado_causacion: string
  }>
  const totalCobrado = cobrosList
    .filter(c => c.estado_causacion === 'CAUSADO' || c.estado_causacion === 'APROBADO')
    .reduce((sum, c) => sum + (c.monto ?? 0), 0)
  const porCobrar = cobrosList
    .filter(c => c.estado_causacion === 'PENDIENTE')
    .reduce((sum, c) => sum + (c.monto ?? 0), 0)

  const bloquesConExtra = base.bloques.map(b => ({
    ...b,
    config_extra: bloqueConfigsExtra[b.id] ?? {},
    items: (itemsByBloqueId[b.instancia?.id ?? ''] ?? []) as Array<{
      id: string
      label: string
      tipo: string
      completado: boolean
      completado_por: string | null
      completado_at: string | null
      link_url: string | null
      imagen_data: string | null
      orden: number
    }>,
  }))

  return {
    negocio: base.negocio,
    bloques: bloquesConExtra,
    etapasLinea: base.etapasLinea,
    profiles: (profilesData ?? []).map(p => ({
      id: p.id,
      full_name: p.full_name,
      email: null as string | null,
    })),
    cobros: ((cobrosData ?? []) as Record<string, unknown>[]).map(c => ({
      id: c.id as string,
      concepto: c.notas as string | null,
      monto: c.monto as number,
      estado_causacion: c.estado_causacion as string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tipo_cobro: (c as any).tipo_cobro as string | null,
      fecha: c.fecha as string | null,
      notas: c.notas as string | null,
    })),
    cotizacion: cotizacion as {
      id: string
      consecutivo: string
      estado: string
      valor_total: number | null
      created_at: string
      oportunidad_id: string | null
    } | null,
    resumenFinanciero: {
      totalCobrado,
      porCobrar,
      costosEjecutados: 0, // Placeholder hasta migrar proyectos
    },
  }
}
