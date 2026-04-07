'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'
import { RAZONES_PERDIDA_NEGOCIO, MOTIVOS_CANCELACION } from '@/lib/negocios/constants'

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
  nombre: string | null
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
  codigo: string | null
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
  empresas: { id: string; nombre: string } | null
  contactos: { id: string; nombre: string } | null
}

export type NegocioResumen = {
  id: string
  nombre: string
  codigo: string | null
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
      codigo,
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
    .in('estado', ['activo', 'abierto'])
    .order('created_at', { ascending: false })

  if (!data) return []

  return (data as Record<string, unknown>[]).map(row => ({
    id: row.id as string,
    nombre: row.nombre as string,
    codigo: row.codigo as string | null,
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
      codigo,
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
      empresas(id, nombre),
      contactos(id, nombre)
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
        nombre,
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

      // Auto-crear instancias faltantes (negocio creado antes de bloque_configs)
      const faltantes = configIds.filter(cid => !instanciasMap[cid])
      if (faltantes.length > 0) {
        const nuevas = faltantes.map(cid => ({
          negocio_id: id,
          bloque_config_id: cid,
          estado: 'pendiente',
          data: {},
        }))
        const { data: creadas } = await db(supabase)
          .from('negocio_bloques')
          .insert(nuevas)
          .select('id, negocio_id, bloque_config_id, estado, data')
        for (const inst of ((creadas ?? []) as Record<string, unknown>[])) {
          instanciasMap[inst.bloque_config_id as string] = inst as unknown as NegocioBloque
        }
      }

      // ── Herencia de data para bloques 'visible' con data vacía ───────────────
      // Cuando un bloque visible no tiene data propia (es nuevo en esta etapa),
      // heredar la data de la instancia más reciente del mismo bloque_definition_id
      // en etapas anteriores del mismo negocio. Esto preserva datos como equipo
      // entre etapas sin mutar las instancias de origen.
      const bloqueConfigsMap = new Map(
        ((bloqueConfigs ?? []) as Record<string, unknown>[]).map(bc => [
          bc.id as string,
          bc as Record<string, unknown>,
        ])
      )
      const visiblesVacios = Object.entries(instanciasMap).filter(([configId, inst]) => {
        const bc = bloqueConfigsMap.get(configId)
        const isVisible = bc?.estado === 'visible'
        const dataVacia = !inst.data || Object.keys(inst.data).length === 0
        return isVisible && dataVacia
      })

      if (visiblesVacios.length > 0) {
        // Recolectar bloque_definition_ids únicos que necesitan herencia
        const defIdsNecesarios = [...new Set(
          visiblesVacios.map(([configId]) => {
            const bc = bloqueConfigsMap.get(configId)
            return bc?.bloque_definition_id as string
          }).filter(Boolean)
        )]

        if (defIdsNecesarios.length > 0) {
          // Buscar todos los negocio_bloques del negocio que tengan data no vacía
          // y cuyo bloque_config tenga uno de esos bloque_definition_id
          const { data: historialRaw } = await db(supabase)
            .from('negocio_bloques')
            .select(`
              id,
              bloque_config_id,
              estado,
              data,
              bloque_configs!inner(bloque_definition_id)
            `)
            .eq('negocio_id', id)
            .not('data', 'is', null)

          // Construir mapa: bloque_definition_id → { data, estado } más reciente con contenido
          const heredadaPorDef: Record<string, { data: Record<string, unknown>; estado: string }> = {}
          for (const raw of ((historialRaw ?? []) as Record<string, unknown>[])) {
            const defId = (raw.bloque_configs as Record<string, unknown> | null)
              ?.bloque_definition_id as string | undefined
            if (!defId || !defIdsNecesarios.includes(defId)) continue
            const dataRaw = raw.data as Record<string, unknown> | null
            if (!dataRaw || Object.keys(dataRaw).length === 0) continue
            // Solo heredar si el configId origen no es de la etapa actual
            // (evitar ciclos: no heredar de sí mismo)
            const configIdOrigen = raw.bloque_config_id as string
            if (configIds.includes(configIdOrigen)) {
              // Este config pertenece a la etapa actual — no heredar de él
              continue
            }
            // Guardar (el query no tiene orden; cualquier instancia previa con data sirve)
            if (!heredadaPorDef[defId]) {
              heredadaPorDef[defId] = {
                data: dataRaw,
                estado: raw.estado as string,
              }
            }
          }

          // Aplicar herencia en memoria (no persistir — solo para el render)
          for (const [configId] of visiblesVacios) {
            const bc = bloqueConfigsMap.get(configId)
            const defId = bc?.bloque_definition_id as string | undefined
            if (!defId) continue
            const heredada = heredadaPorDef[defId]
            if (!heredada) continue
            instanciasMap[configId] = {
              ...instanciasMap[configId],
              data: heredada.data,
              // Propagar estado completo solo en memoria — el gate sigue leyendo de DB
              ...(heredada.estado === 'completo' ? { estado: 'completo' as const } : {}),
            }
          }
        }
      }
      // ── Fin herencia ──────────────────────────────────────────────────────────
    }

    bloques = ((bloqueConfigs ?? []) as Record<string, unknown>[]).map(bc => ({
      id: bc.id as string,
      etapa_id: bc.etapa_id as string,
      workspace_id: bc.workspace_id as string,
      bloque_definition_id: bc.bloque_definition_id as string,
      estado: bc.estado as 'editable' | 'visible',
      orden: bc.orden as number,
      es_gate: bc.es_gate as boolean,
      nombre: (bc.nombre as string | null) ?? null,
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
  // Creacion inline si no existe aun en DB
  contacto_nombre?: string
  contacto_telefono?: string
  empresa_nombre?: string
  empresa_sector?: string
  es_persona_natural?: boolean
}): Promise<{ negocio_id: string | null; error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { negocio_id: null, error: 'No autenticado' }

  // Crear contacto inline si no existe
  let contactoId = input.contacto_id
  if (!contactoId && input.contacto_nombre?.trim()) {
    const { data: newContact } = await supabase
      .from('contactos')
      .insert({
        workspace_id: workspaceId,
        nombre: input.contacto_nombre.trim(),
        telefono: input.contacto_telefono?.trim() || null,
      })
      .select('id')
      .single()
    contactoId = (newContact as { id: string } | null)?.id
  }

  // Persona natural: auto-crear empresa vinculada al contacto
  let empresaId = input.empresa_id
  if (input.es_persona_natural && contactoId) {
    // Buscar empresa ya vinculada a este contacto
    const { data: existingEmpresa } = await supabase
      .from('empresas')
      .select('id')
      .eq('contacto_id', contactoId)
      .maybeSingle()

    if (existingEmpresa) {
      empresaId = existingEmpresa.id
    } else {
      // Obtener nombre del contacto para la empresa
      let contactName = input.contacto_nombre?.trim() || 'Persona Natural'
      if (!input.contacto_nombre && contactoId) {
        const { data: c } = await supabase.from('contactos').select('nombre').eq('id', contactoId).single()
        if (c) contactName = c.nombre
      }
      const { data: newEmpresa } = await supabase
        .from('empresas')
        .insert({
          workspace_id: workspaceId,
          nombre: contactName,
          tipo_persona: 'natural',
          contacto_id: contactoId,
          tipo_documento: 'CC',
          codigo: '',
        })
        .select('id')
        .single()
      if (newEmpresa) empresaId = newEmpresa.id
    }
  }

  // Crear empresa inline si no es persona natural y no existe
  if (!input.es_persona_natural && !empresaId && input.empresa_nombre?.trim()) {
    const { data: newEmpresa } = await db(supabase)
      .from('empresas')
      .insert({
        workspace_id: workspaceId,
        nombre: input.empresa_nombre.trim(),
        sector: input.empresa_sector?.trim() || null,
      })
      .select('id')
      .single()
    empresaId = (newEmpresa as { id: string } | null)?.id
  }

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
      empresa_id: empresaId ?? null,
      contacto_id: contactoId ?? null,
      precio_estimado: input.precio_estimado ?? null,
      etapa_actual_id: primeraEtapa?.id ?? null,
      stage_actual: primeraEtapa?.stage ?? null,
      estado: 'abierto',
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
      .select('id, config_extra, bloque_definitions(tipo)')
      .eq('etapa_id', primeraEtapa.id)
      .eq('workspace_id', workspaceId)

    if (bloqueConfigs && (bloqueConfigs as Record<string, unknown>[]).length > 0) {
      const instancias = (bloqueConfigs as Record<string, unknown>[]).map(bc => ({
        negocio_id: negocioData.id,
        bloque_config_id: bc.id as string,
        estado: 'pendiente',
        data: {},
      }))

      await db(supabase).from('negocio_bloques').insert(instancias)

      // ── Auto-cotización: si algún bloque cotización tiene config auto_cotizacion ──
      for (const bc of bloqueConfigs as Array<{
        id: string
        config_extra: Record<string, unknown> | null
        bloque_definitions: { tipo: string } | null
      }>) {
        const tipoBd = bc.bloque_definitions?.tipo
        const autoCot = (bc.config_extra?.auto_cotizacion ?? null) as {
          servicio_nombre: string
          usar_precio_estimado?: boolean
        } | null

        if (tipoBd === 'cotizacion' && autoCot) {
          await crearCotizacionAutomatica(
            supabase,
            workspaceId,
            negocioData.id,
            autoCot.servicio_nombre,
            autoCot.usar_precio_estimado ? (input.precio_estimado ?? 0) : 0
          )
        }
      }
    }
  }

  revalidatePath('/negocios')
  return { negocio_id: negocioData.id, error: null }
}

// ── Auto-crear cotización al crear negocio ──────────────────────────────────
// Se llama internamente desde crearNegocio() si el bloque cotización tiene
// config_extra.auto_cotizacion configurado (ej: SOENA VE).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function crearCotizacionAutomatica(
  supabase: any,
  workspaceId: string,
  negocioId: string,
  servicioNombre: string,
  precioEstimado: number
) {
  // 1. Obtener consecutivo
  const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  const consecutivo = consecutivoRaw ?? `COT-${new Date().getFullYear()}-${Date.now()}`

  // 2. Crear cotización detallada en borrador
  const { data: cotData, error: cotErr } = await supabase
    .from('cotizaciones')
    .insert({
      workspace_id: workspaceId,
      negocio_id: negocioId,
      consecutivo,
      codigo: '',
      modo: 'detallada',
      valor_total: precioEstimado,
      estado: 'borrador',
    })
    .select('id')
    .single()

  if (cotErr || !cotData) return

  const cotizacionId = cotData.id

  // 3. Buscar servicio por nombre en el workspace
  const { data: servicio } = await supabase
    .from('servicios')
    .select('id, nombre, precio_estandar, rubros_template')
    .eq('workspace_id', workspaceId)
    .ilike('nombre', servicioNombre)
    .eq('activo', true)
    .limit(1)
    .single()

  if (!servicio) return

  // 4. Crear item desde el servicio
  const rubrosTemplate = servicio.rubros_template as Array<{
    tipo: string; descripcion?: string; cantidad: number; unidad: string; valor_unitario: number
  }> | null

  const subtotal = rubrosTemplate && rubrosTemplate.length > 0
    ? rubrosTemplate.reduce((sum: number, r: { cantidad: number; valor_unitario: number }) => sum + (r.cantidad * r.valor_unitario), 0)
    : (servicio.precio_estandar ?? 0)

  const { data: newItem } = await supabase
    .from('items')
    .insert({
      cotizacion_id: cotizacionId,
      nombre: servicio.nombre,
      subtotal,
      orden: 1,
      servicio_origen_id: servicio.id,
    })
    .select('id')
    .single()

  // 5. Deep copy rubros del template
  if (rubrosTemplate && rubrosTemplate.length > 0 && newItem) {
    const rubrosToInsert = rubrosTemplate.map((r: { tipo: string; descripcion?: string; cantidad: number; unidad: string; valor_unitario: number }) => ({
      item_id: newItem.id,
      tipo: r.tipo,
      descripcion: r.descripcion || null,
      cantidad: r.cantidad,
      unidad: r.unidad,
      valor_unitario: r.valor_unitario,
    }))
    await supabase.from('rubros').insert(rubrosToInsert)
  }

  // 6. Si precio_estimado > 0, ya se puso como valor_total arriba.
  //    Si es 0, usar precio_estandar del servicio.
  if (precioEstimado === 0 && servicio.precio_estandar > 0) {
    await supabase
      .from('cotizaciones')
      .update({ valor_total: servicio.precio_estandar })
      .eq('id', cotizacionId)
  }
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
  // Solo heredar estado/data para bloques VISIBLE (editable siempre empieza pendiente)
  const { data: bloqueConfigs } = await db(supabase)
    .from('bloque_configs')
    .select('id, bloque_definition_id, estado')
    .eq('etapa_id', nuevaEtapaId)
    .eq('workspace_id', workspaceId)

  if (bloqueConfigs && (bloqueConfigs as Record<string, unknown>[]).length > 0) {
    const typedConfigs = bloqueConfigs as Array<{ id: string; bloque_definition_id: string; estado: string }>
    const configIds = typedConfigs.map(b => b.id)

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

    // Obtener bloques completados de este negocio (de cualquier etapa) con su definition_id + bloque_items
    const { data: completadosRaw } = await db(supabase)
      .from('negocio_bloques')
      .select('id, estado, data, completado_at, bloque_configs(bloque_definition_id)')
      .eq('negocio_id', negocioId)
      .eq('estado', 'completo')

    const completadosPorDef = new Map<string, { id: string; data: Record<string, unknown>; completado_at: string | null }>()
    for (const c of ((completadosRaw ?? []) as Record<string, unknown>[])) {
      const defId = (c.bloque_configs as Record<string, unknown> | null)?.bloque_definition_id as string | null
      if (defId) {
        completadosPorDef.set(defId, {
          id: c.id as string,
          data: (c.data ?? {}) as Record<string, unknown>,
          completado_at: c.completado_at as string | null,
        })
      }
    }

    const nuevas = typedConfigs
      .filter(bc => !existingIds.has(bc.id))
      .map(bc => {
        // Solo heredar para bloques VISIBLE — editables empiezan en blanco
        const isVisible = bc.estado === 'visible'
        const prevCompleto = isVisible ? completadosPorDef.get(bc.bloque_definition_id) : undefined
        return {
          negocio_id: negocioId,
          bloque_config_id: bc.id,
          estado: prevCompleto ? 'completo' : 'pendiente',
          data: prevCompleto?.data ?? {},
          completado_at: prevCompleto?.completado_at ?? null,
        }
      })

    if (nuevas.length > 0) {
      const { data: insertadas } = await db(supabase)
        .from('negocio_bloques')
        .insert(nuevas)
        .select('id, bloque_config_id')

      // Copiar bloque_items para bloques visibles que heredaron de un bloque previo
      if (insertadas) {
        for (const inst of (insertadas as Array<{ id: string; bloque_config_id: string }>)) {
          const bc = typedConfigs.find(c => c.id === inst.bloque_config_id)
          if (!bc || bc.estado !== 'visible') continue
          const prev = completadosPorDef.get(bc.bloque_definition_id)
          if (!prev) continue

          // Copiar items del bloque fuente al nuevo bloque visible
          const { data: sourceItems } = await db(supabase)
            .from('bloque_items')
            .select('orden, label, tipo, contenido, completado, completado_por, completado_at, link_url, imagen_data')
            .eq('negocio_bloque_id', prev.id)

          if (sourceItems && (sourceItems as unknown[]).length > 0) {
            const copiedItems = (sourceItems as Record<string, unknown>[]).map(item => ({
              ...item,
              negocio_bloque_id: inst.id,
            }))
            await db(supabase).from('bloque_items').insert(copiedItems)
          }
        }
      }
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
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
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

  // resolvedEtapaId puede cambiar si routing auto-corrige el destino
  let resolvedEtapaId = nuevaEtapaId

  // Validar que la nueva etapa es la siguiente en orden (o un salto permitido por routing)
  let etapaActualNombre: string | null = null
  let etapaActualConfigExtra: Record<string, unknown> = {}
  if (negocio.etapa_actual_id) {
    const [etapaActualRes, nuevaEtapaRes] = await Promise.all([
      db(supabase)
        .from('etapas_negocio')
        .select('orden, linea_id, config_extra, nombre')
        .eq('id', negocio.etapa_actual_id)
        .single(),
      db(supabase)
        .from('etapas_negocio')
        .select('orden, linea_id')
        .eq('id', nuevaEtapaId)
        .single(),
    ])

    const etapaActualData = etapaActualRes.data as { orden: number; linea_id: string; config_extra: Record<string, unknown>; nombre: string } | null
    const nuevaEtapaData = nuevaEtapaRes.data as { orden: number; linea_id: string } | null

    if (!etapaActualData || !nuevaEtapaData) return { error: 'Etapa no encontrada' }
    etapaActualNombre = etapaActualData.nombre ?? null
    etapaActualConfigExtra = etapaActualData.config_extra ?? {}
    if (etapaActualData.linea_id !== nuevaEtapaData.linea_id) return { error: 'Etapas de líneas distintas' }

    // Evaluar routing condicional (si existe) ANTES de validar orden
    const routing = (etapaActualData.config_extra?.routing ?? null) as {
      default_etapa_orden: number
      conditional: Array<{ condition: { field: string; value: string }; etapa_orden: number }>
    } | null

    if (routing) {
      // Leer datos del negocio para evaluar condiciones
      const { data: bloquesDatos } = await db(supabase)
        .from('negocio_bloques')
        .select(`
          data,
          bloque_configs!inner(
            etapa_id,
            bloque_definitions!inner(tipo)
          )
        `)
        .eq('negocio_id', negocioId)
        .eq('bloque_configs.etapa_id', negocio.etapa_actual_id)

      const camposNegocio: Record<string, unknown> = {}
      for (const b of ((bloquesDatos ?? []) as Record<string, unknown>[])) {
        const tipo = ((b.bloque_configs as Record<string, unknown>)?.bloque_definitions as Record<string, unknown> | null)?.tipo
        if (tipo === 'datos' && b.data && typeof b.data === 'object') {
          Object.assign(camposNegocio, b.data)
        }
      }

      // Evaluar condicionales — primer match gana
      let etapaOrdenDestino = routing.default_etapa_orden
      for (const rule of routing.conditional) {
        const { field, value } = rule.condition
        if (String(camposNegocio[field] ?? '') === String(value)) {
          etapaOrdenDestino = rule.etapa_orden
          break
        }
      }

      // Auto-corregir destino si routing resuelve a una etapa diferente
      if (nuevaEtapaData.orden !== etapaOrdenDestino) {
        const { data: etapaCorrecta } = await db(supabase)
          .from('etapas_negocio')
          .select('id, orden, linea_id')
          .eq('linea_id', etapaActualData.linea_id)
          .eq('orden', etapaOrdenDestino)
          .single()

        if (etapaCorrecta) {
          resolvedEtapaId = (etapaCorrecta as { id: string }).id
        } else {
          return { error: 'Etapa destino de routing no encontrada' }
        }
      }
    } else {
      // Sin routing: solo avance secuencial
      const ordenSiguiente = etapaActualData.orden + 1
      if (nuevaEtapaData.orden !== ordenSiguiente) {
        return { error: 'Solo puedes avanzar a la siguiente etapa en orden' }
      }
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

      const bloquesPendientes = ((bloquesPendientesRaw ?? []) as Record<string, unknown>[]).map(
        (b: Record<string, unknown>) => ({
          nombre: ((b.bloque_definitions as { nombre: string } | null)?.nombre ?? 'Bloque'),
          es_gate: b.es_gate as boolean,
        })
      )

      return { error: 'gate_bloqueado', bloquesPendientes }
    }

    // Gate custom: comentario_requerido — debe haber al menos un comentario en actividad
    const etapaGates = (etapaActualConfigExtra.gates ?? []) as string[]
    if (etapaGates.includes('comentario_requerido')) {
      const { count } = await supabase
        .from('activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('entidad_tipo', 'negocio')
        .eq('entidad_id', negocioId)
        .eq('tipo', 'comentario')
      if ((count ?? 0) === 0) {
        return { error: 'gate_bloqueado', bloquesPendientes: [{ nombre: 'Comentario en actividad', es_gate: true }] }
      }
    }
  }

  // Obtener nombre de la nueva etapa para el log
  const { data: nuevaEtapaInfoRaw } = await db(supabase)
    .from('etapas_negocio')
    .select('nombre')
    .eq('id', resolvedEtapaId)
    .single()
  const nuevaEtapaNombre = (nuevaEtapaInfoRaw as { nombre: string } | null)?.nombre ?? resolvedEtapaId

  // Cambiar etapa
  const resultCambio = await cambiarEtapaNegocio(negocioId, resolvedEtapaId)
  if (resultCambio.error) return resultCambio

  // Registrar en activity_log
  if (staffId) {
    await supabase
      .from('activity_log')
      .insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'cambio_etapa',
        autor_id: staffId,
        campo_modificado: 'etapa',
        valor_anterior: etapaActualNombre,
        valor_nuevo: nuevaEtapaNombre,
        contenido: motivoOverride ? `Override: ${motivoOverride}` : null,
      })
  }

  return resultCambio
}

// ── Marcar bloque completo ─────────────────────────────────────────────────────

export async function marcarBloqueCompleto(
  negocioBloqueId: string,
  data: Record<string, unknown>
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  // Leer datos actuales + negocio_id del servidor y hacer merge (evita sobreescribir campos AI)
  const { data: currentBloque } = await db(supabase)
    .from('negocio_bloques')
    .select('data, negocio_id')
    .eq('id', negocioBloqueId)
    .single()

  const negocioId = (currentBloque as Record<string, unknown> | null)?.negocio_id as string | null
  const currentData = (currentBloque?.data as Record<string, unknown>) ?? {}
  const mergedData = { ...currentData, ...data }

  const { error: updateError } = await db(supabase)
    .from('negocio_bloques')
    .update({
      estado: 'completo',
      data: mergedData,
      completado_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', negocioBloqueId)

  if (updateError) return { error: (updateError as { message: string }).message }

  // Siempre revalidar la página del negocio después de marcar completo
  if (negocioId) {
    revalidatePath(`/negocios/${negocioId}`)
  }

  // ── Trigger auto-cobros si el bloque tiene esa configuración ─────────
  const { data: bloqueRaw } = await db(supabase)
    .from('negocio_bloques')
    .select(`
      negocio_id,
      bloque_config_id,
      bloque_configs(
        nombre,
        config_extra,
        bloque_definitions(tipo, nombre)
      )
    `)
    .eq('id', negocioBloqueId)
    .single()

  if (bloqueRaw) {
    const bloque = bloqueRaw as {
      negocio_id: string
      bloque_config_id: string
      bloque_configs: {
        nombre: string | null
        config_extra: Record<string, unknown>
        bloque_definitions: { tipo: string; nombre: string } | null
      } | null
    }

    const tipo = bloque.bloque_configs?.bloque_definitions?.tipo
    const configExtra = bloque.bloque_configs?.config_extra ?? {}
    const triggers = (configExtra.triggers ?? []) as Array<{ event: string; action: string; params?: Record<string, unknown> }>

    const autoCobros = triggers.find(t => t.action === 'auto_cobros')
    if (tipo === 'datos' && autoCobros) {
      const valorAnticipo = mergedData.valor_anticipo as number | undefined
      const referenciaEpayco = mergedData.referencia_anticipo as string | undefined
      if (valorAnticipo) {
        await autoCrearCobros(bloque.negocio_id, valorAnticipo, referenciaEpayco)
      }
    }

    const autoCobrosMulti = triggers.find(t => t.action === 'auto_cobros_multi')
    if (tipo === 'datos' && autoCobrosMulti) {
      const pagos = (mergedData.pagos ?? []) as Array<{ referencia_epayco: string; valor_pago: number }>
      if (pagos.length > 0) {
        await autoCrearCobrosMulti(bloque.negocio_id, pagos)
      }
    }

    // Registrar en activity_log
    if (staffId && workspaceId) {
      const bloqueNombre = bloque.bloque_configs?.nombre ?? bloque.bloque_configs?.bloque_definitions?.nombre ?? 'Bloque'
      await supabase
        .from('activity_log')
        .insert({
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: bloque.negocio_id,
          tipo: 'cambio',
          autor_id: staffId,
          campo_modificado: 'bloque',
          contenido: `Bloque "${bloqueNombre}" completado`,
        })
    }
  }

  return { error: null }
}

// ── Actualizar data del bloque sin marcar completo ────────────────────────────

export async function actualizarBloqueData(
  negocioBloqueId: string,
  data: Record<string, unknown>,
  negocioId?: string
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  const { data: row, error: updateError } = await db(supabase)
    .from('negocio_bloques')
    .update({
      data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', negocioBloqueId)
    .select('negocio_id')
    .single()

  if (updateError) return { error: (updateError as { message: string }).message }

  const nid = negocioId ?? (row as Record<string, unknown>)?.negocio_id as string | undefined
  if (nid) revalidatePath(`/negocios/${nid}`)

  // Registrar en activity_log
  if (staffId && workspaceId && nid) {
    await supabase
      .from('activity_log')
      .insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: nid,
        tipo: 'cambio',
        autor_id: staffId,
        campo_modificado: 'bloque_datos',
        contenido: 'Datos de bloque actualizados',
      })
  }

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
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
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

  // Registrar en activity_log
  if (staffId && workspaceId) {
    const { data: itemInfo } = await db(supabase)
      .from('bloque_items')
      .select('label, negocio_bloque_id')
      .eq('id', bloqueItemId)
      .single()

    if (itemInfo) {
      const item = itemInfo as { label: string; negocio_bloque_id: string }
      const { data: bloqueInfo } = await db(supabase)
        .from('negocio_bloques')
        .select('negocio_id')
        .eq('id', item.negocio_bloque_id)
        .single()

      const negocioId = (bloqueInfo as { negocio_id: string } | null)?.negocio_id
      if (negocioId) {
        await supabase
          .from('activity_log')
          .insert({
            workspace_id: workspaceId,
            entidad_tipo: 'negocio',
            entidad_id: negocioId,
            tipo: 'cambio',
            autor_id: staffId,
            campo_modificado: 'checklist_item',
            contenido: completado ? `"${item.label}" marcado como completado` : `"${item.label}" desmarcado`,
          })
      }
    }
  }

  return { error: null }
}

// ── Auto-crear cobro anticipo (solo 1, idempotente) ─────────────────────────

export async function autoCrearCobros(
  negocioId: string,
  valorAnticipo: number,
  referenciaEpayco?: string
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Idempotencia: verificar si ya existe un cobro anticipo para este negocio
  const { data: existente } = await db(supabase)
    .from('cobros')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .eq('tipo_cobro', 'anticipo')
    .limit(1)

  if (existente && (existente as unknown[]).length > 0) {
    // Ya existe anticipo — actualizar monto y referencia
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('cobros').update({
      monto: valorAnticipo,
      external_ref: referenciaEpayco ?? null,
    }).eq('id', (existente as Record<string, unknown>[])[0].id)
    revalidatePath(`/negocios/${negocioId}`)
    return { error: null }
  }

  const cobro = {
    workspace_id: workspaceId,
    negocio_id: negocioId,
    concepto: 'Anticipo',
    monto: valorAnticipo,
    tipo_cobro: 'anticipo',
    estado_causacion: 'PENDIENTE',
    fecha: new Date().toISOString().split('T')[0],
    external_ref: referenciaEpayco ?? null,
    factura_id: null,
    proyecto_id: null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (supabase as any).from('cobros').insert(cobro)
  if (insertError) return { error: (insertError as { message: string }).message }

  revalidatePath(`/negocios/${negocioId}`)
  return { error: null }
}

// ── Auto-crear cobros multi-pago (etapa 7, idempotente por external_ref) ─────

export async function autoCrearCobrosMulti(
  negocioId: string,
  pagos: Array<{ referencia_epayco: string; valor_pago: number }>
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  if (!pagos.length) return { error: null }

  // Verificar cuales refs ya existen para idempotencia
  const refs = pagos.map(p => p.referencia_epayco)
  const { data: existentes } = await db(supabase)
    .from('cobros')
    .select('external_ref')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .in('external_ref', refs)

  const existingRefs = new Set(
    ((existentes ?? []) as Record<string, unknown>[]).map(e => e.external_ref as string)
  )

  const nuevos = pagos
    .filter(p => !existingRefs.has(p.referencia_epayco))
    .map(p => ({
      workspace_id: workspaceId,
      negocio_id: negocioId,
      concepto: 'Pago',
      monto: p.valor_pago,
      tipo_cobro: 'pago',
      estado_causacion: 'PENDIENTE',
      fecha: new Date().toISOString().split('T')[0],
      external_ref: p.referencia_epayco,
      factura_id: null,
      proyecto_id: null,
    }))

  if (nuevos.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertError } = await (supabase as any).from('cobros').insert(nuevos)
    if (insertError) return { error: (insertError as { message: string }).message }
  }

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
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Obtener datos del cobro antes de actualizar (para el log)
  const { data: cobroAntes } = await db(supabase)
    .from('cobros')
    .select('notas, monto, negocio_id')
    .eq('id', cobroId)
    .eq('workspace_id', workspaceId)
    .single()

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

  // Registrar en activity_log
  if (staffId && cobroAntes) {
    const cobro = cobroAntes as { notas: string | null; monto: number; negocio_id: string | null }
    const negocioId = cobro.negocio_id
    if (negocioId) {
      const montoFinal = valorParcial ?? cobro.monto
      await supabase
        .from('activity_log')
        .insert({
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: negocioId,
          tipo: 'cambio',
          autor_id: staffId,
          campo_modificado: 'cobro_confirmado',
          contenido: `Pago confirmado: ${cobro.notas ?? 'Cobro'} por $${montoFinal.toLocaleString('es-CO')}`,
        })
    }
  }

  revalidatePath('/negocios')
  return { error: null }
}

// ── Actualizar precio aprobado del negocio ───────────────────────────────────

export async function actualizarPrecioAprobado(
  negocioId: string,
  precio: number
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Obtener precio anterior para el log
  const { data: negocioAntes } = await db(supabase)
    .from('negocios')
    .select('precio_aprobado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  const precioAnterior = (negocioAntes as { precio_aprobado: number | null } | null)?.precio_aprobado

  const { error: updateError } = await db(supabase)
    .from('negocios')
    .update({ precio_aprobado: precio, updated_at: new Date().toISOString() })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updateError) return { error: (updateError as { message: string }).message }

  // Registrar en activity_log
  if (staffId) {
    await supabase
      .from('activity_log')
      .insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'cambio',
        autor_id: staffId,
        campo_modificado: 'precio_aprobado',
        valor_anterior: precioAnterior != null ? String(precioAnterior) : null,
        valor_nuevo: String(precio),
        contenido: `Precio aprobado actualizado a $${precio.toLocaleString('es-CO')}`,
      })
  }

  revalidatePath(`/negocios/${negocioId}`)
  return { error: null }
}

// ── Agregar comentario al activity log del negocio ────────────────────────────

export async function agregarComentarioNegocio(
  negocioId: string,
  contenido: string
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  if (!staffId) return { error: 'Sin perfil de staff' }

  const { error: insertError } = await supabase
    .from('activity_log')
    .insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'comentario',
      autor_id: staffId,
      contenido,
    })

  if (insertError) return { error: (insertError as { message: string }).message }
  revalidatePath(`/negocios/${negocioId}`)
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
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
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

  // Registrar en activity_log
  if (staffId && workspaceId) {
    const { data: bloqueInfo } = await db(supabase)
      .from('negocio_bloques')
      .select('negocio_id')
      .eq('id', negocioBloqueId)
      .single()

    const negocioId = (bloqueInfo as { negocio_id: string } | null)?.negocio_id
    if (negocioId) {
      const estadoLabel = data.estado ?? 'pendiente'
      const contenido = data.comentario
        ? `Aprobación: ${estadoLabel}. ${data.comentario}`
        : `Aprobación: ${estadoLabel}`
      await supabase
        .from('activity_log')
        .insert({
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: negocioId,
          tipo: 'cambio',
          autor_id: staffId,
          campo_modificado: 'aprobacion',
          valor_nuevo: estadoLabel,
          contenido,
        })
    }
  }

  return { error: null }
}

// ── Cargar datos completos para detalle con bloques ───────────────────────────

export type CotizacionResumen = {
  id: string
  consecutivo: string | null
  modo: string | null
  estado: string | null
  valor_total: number | null
  descripcion: string | null
  created_at: string | null
}

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
  currentUserId: string | null
  userRole: string
  cobros: Array<{
    id: string
    concepto: string | null
    monto: number
    estado_causacion: string
    tipo_cobro: string | null
    fecha: string | null
    notas: string | null
    external_ref: string | null
  }>
  cotizacion: null
  cotizacionesNegocio: CotizacionResumen[]
  resumenFinanciero: {
    totalCobrado: number
    porCobrar: number
    costosEjecutados: number
  }
  actividad: Array<{
    id: string
    tipo: string
    autor_id: string | null
    contenido: string | null
    created_at: string
    autor_nombre: string | null
  }>
  staffList: Array<{ id: string; full_name: string }>
} | null> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
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

  // Cargar profiles + staff del workspace + currentUserId
  const [profilesRes, userRes, staffRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('workspace_id', workspaceId)
      .order('full_name', { ascending: true }),
    supabase.auth.getUser(),
    supabase
      .from('staff')
      .select('id, full_name')
      .eq('workspace_id', workspaceId),
  ])
  const profilesData = profilesRes.data
  const currentUserId = userRes.data.user?.id ?? null

  // staffMap: staff.id → nombre (activity_log.autor_id referencia staff.id)
  const staffMap: Record<string, string> = {}
  for (const s of ((staffRes.data ?? []) as { id: string; full_name: string }[])) {
    staffMap[s.id] = s.full_name ?? s.id.slice(-6)
  }

  // Cargar cobros del negocio (db() para evitar type errors en columnas nuevas)
  const { data: cobrosData } = await db(supabase)
    .from('cobros')
    .select('id, notas, monto, estado_causacion, tipo_cobro, fecha, external_ref')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', id)
    .order('created_at', { ascending: true })

  // Cotización ahora vive en negocio_bloques.data del bloque cotizacion (sin tabla separada)
  const cotizacion = null

  // Cargar cotizaciones del sistema de cotizaciones (tabla cotizaciones con negocio_id)
  const cotizacionesRes = await supabase
    .from('cotizaciones')
    .select('id, consecutivo, modo, estado, valor_total, descripcion, created_at')
    .eq('negocio_id' as never, id)
    .order('created_at', { ascending: false })
  const cotizacionesNegocio: CotizacionResumen[] = ((cotizacionesRes.data ?? []) as Record<string, unknown>[]).map(c => ({
    id: c.id as string,
    consecutivo: c.consecutivo as string | null,
    modo: c.modo as string | null,
    estado: c.estado as string | null,
    valor_total: c.valor_total as number | null,
    descripcion: c.descripcion as string | null,
    created_at: c.created_at as string | null,
  }))

  // Cargar actividad del negocio
  const { data: actividadData } = await supabase
    .from('activity_log')
    .select('id, tipo, autor_id, contenido, created_at')
    .eq('workspace_id', workspaceId)
    .eq('entidad_tipo', 'negocio')
    .eq('entidad_id', id)
    .order('created_at', { ascending: false })
    .limit(50)

  const actividad = ((actividadData ?? []) as Record<string, unknown>[]).map(a => ({
    id: a.id as string,
    tipo: a.tipo as string,
    autor_id: a.autor_id as string | null,
    contenido: a.contenido as string | null,
    created_at: a.created_at as string,
    // autor_id referencia staff.id (no profiles.id)
    autor_nombre: a.autor_id ? (staffMap[a.autor_id as string] ?? null) : null,
  }))

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
    currentUserId,
    userRole: role ?? 'read_only',
    cobros: ((cobrosData ?? []) as Record<string, unknown>[]).map(c => ({
      id: c.id as string,
      concepto: c.notas as string | null,
      monto: c.monto as number,
      estado_causacion: c.estado_causacion as string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tipo_cobro: (c as any).tipo_cobro as string | null,
      fecha: c.fecha as string | null,
      notas: c.notas as string | null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      external_ref: (c as any).external_ref as string | null,
    })),
    cotizacion,
    cotizacionesNegocio,
    resumenFinanciero: {
      totalCobrado,
      porCobrar,
      costosEjecutados: 0,
    },
    actividad,
    staffList: ((staffRes.data ?? []) as { id: string; full_name: string }[]).map(s => ({
      id: s.id,
      full_name: s.full_name,
    })),
  }
}

// ── Actualizar carpeta URL del negocio ────────────────────────────────────────

export async function actualizarCarpetaUrlNegocio(
  negocioId: string,
  carpetaUrl: string
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const url = carpetaUrl.trim()

  // Obtener valor anterior para comparar
  const { data: negocioAntes } = await db(supabase)
    .from('negocios')
    .select('carpeta_url')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  const urlAnterior = (negocioAntes as { carpeta_url: string | null } | null)?.carpeta_url

  const { error: updErr } = await db(supabase)
    .from('negocios')
    .update({ carpeta_url: url || null })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updErr) return { error: (updErr as { message: string }).message }

  // Registrar en activity_log solo si cambió
  if (staffId && (urlAnterior ?? '') !== (url || '')) {
    await supabase
      .from('activity_log')
      .insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'cambio',
        autor_id: staffId,
        campo_modificado: 'carpeta_url',
        valor_anterior: urlAnterior ?? null,
        valor_nuevo: url || null,
        contenido: url ? 'Carpeta Drive actualizada' : 'Carpeta Drive eliminada',
      })
  }

  revalidatePath(`/negocios/${negocioId}`)
  return { error: null }
}

// ── Cerrar negocio ────────────────────────────────────────────────────────────

// ── Perder negocio (stage venta) ──────────────────────────────────────────────

export async function perderNegocio(
  negocioId: string,
  razon: string,
  notas?: string,
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Validar que existe y esta en stage venta
  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, stage_actual, estado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!negocio) return { error: 'Negocio no encontrado' }
  if (negocio.stage_actual !== 'venta') {
    return { error: 'Solo se puede perder un negocio en etapa de venta' }
  }
  if (negocio.estado !== 'abierto' && negocio.estado !== 'activo') {
    return { error: 'El negocio ya esta cerrado' }
  }

  const { error: updErr } = await db(supabase)
    .from('negocios')
    .update({
      estado: 'perdido',
      razon_cierre: razon,
      descripcion_cierre: notas ?? null,
      closed_at: new Date().toISOString(),
    })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updErr) return { error: (updErr as { message: string }).message }

  // Log en activity_log
  const razonLabel = RAZONES_PERDIDA_NEGOCIO.find(r => r.value === razon)?.label ?? razon
  if (staffId) {
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_estado',
      autor_id: staffId,
      contenido: `Negocio perdido. Motivo: ${razonLabel}`,
      valor_nuevo: 'perdido',
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null }
}

// ── Cancelar negocio (stage ejecucion) ────────────────────────────────────────

export async function cancelarNegocio(
  negocioId: string,
  motivo: string,
  descripcion: string,
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  if (!descripcion || descripcion.trim().length < 20) {
    return { error: 'La descripcion debe tener al menos 20 caracteres' }
  }

  // Validar que existe y esta en stage ejecucion
  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, stage_actual, estado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!negocio) return { error: 'Negocio no encontrado' }
  if (negocio.stage_actual !== 'ejecucion') {
    return { error: 'Solo se puede cancelar un proyecto en etapa de ejecucion' }
  }
  if (negocio.estado !== 'abierto' && negocio.estado !== 'activo') {
    return { error: 'El negocio ya esta cerrado' }
  }

  const { error: updErr } = await db(supabase)
    .from('negocios')
    .update({
      estado: 'cancelado',
      razon_cierre: motivo,
      descripcion_cierre: descripcion.trim(),
      closed_at: new Date().toISOString(),
    })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updErr) return { error: (updErr as { message: string }).message }

  const motivoLabel = MOTIVOS_CANCELACION.find(m => m.value === motivo)?.label ?? motivo
  if (staffId) {
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_estado',
      autor_id: staffId,
      contenido: `Proyecto cancelado. Motivo: ${motivoLabel}`,
      valor_nuevo: 'cancelado',
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null }
}

// ── Completar negocio (stage cobro) ───────────────────────────────────────────

export async function completarNegocio(
  negocioId: string,
  lecciones?: string,
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Validar que existe y esta en stage cobro
  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, stage_actual, estado, precio_aprobado, precio_estimado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!negocio) return { error: 'Negocio no encontrado' }
  if (negocio.stage_actual !== 'cobro') {
    return { error: 'Solo se puede completar un negocio en etapa de cobro' }
  }
  if (negocio.estado !== 'abierto' && negocio.estado !== 'activo') {
    return { error: 'El negocio ya esta cerrado' }
  }

  // Calcular snapshot financiero: buscar cobros del negocio
  const { data: cobrosData } = await db(supabase)
    .from('cobros')
    .select('monto, estado_causacion')
    .eq('negocio_id', negocioId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cobros = ((cobrosData ?? []) as any[]) as Array<{ monto: number; estado_causacion: string }>
  const totalCobrado = cobros
    .filter(c => c.estado_causacion === 'CAUSADO' || c.estado_causacion === 'APROBADO')
    .reduce((sum, c) => sum + (c.monto ?? 0), 0)
  const pendiente = cobros
    .filter(c => c.estado_causacion === 'PENDIENTE')
    .reduce((sum, c) => sum + (c.monto ?? 0), 0)
  const precioAprobado = negocio.precio_aprobado ?? negocio.precio_estimado ?? 0

  const snapshot = {
    fecha_cierre: new Date().toISOString(),
    precio_aprobado: precioAprobado,
    total_cobrado: totalCobrado,
    pendiente_cobro: pendiente,
    margen: totalCobrado - 0, // sin costos ejecutados por ahora
  }

  const { error: updErr } = await db(supabase)
    .from('negocios')
    .update({
      estado: 'completado',
      lecciones_aprendidas: lecciones?.trim() || null,
      cierre_snapshot: snapshot,
      closed_at: new Date().toISOString(),
    })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updErr) return { error: (updErr as { message: string }).message }

  if (staffId) {
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_estado',
      autor_id: staffId,
      contenido: 'Proyecto completado',
      valor_nuevo: 'completado',
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null }
}

// Constantes de cierre movidas a src/lib/negocios/constants.ts para evitar
// error "use server file can only export async functions"
