'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'
import { RAZONES_PERDIDA_NEGOCIO, MOTIVOS_CANCELACION, MOTIVOS_PAUSA, MAX_PAUSAS, MAX_DIAS_PAUSA, SAFETY_NET_HORAS } from '@/lib/negocios/constants'
import { createDriveFolder } from '@/lib/google-drive'
import { todayBogotaISO, bogotaYear } from '@/lib/dates/bogota'
import { bloqueTipoCode } from '@/components/workflow/types'
import { mapCiudadASeccional } from '@/lib/dian/seccionales'

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
  numero: number
}

export type EtapaNegocio = {
  id: string
  linea_id: string
  stage: 'venta' | 'ejecucion' | 'cobro'
  nombre: string
  orden: number
  numero: number
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
  /** ID corto unico dentro de la linea (ej: DC1, DA2, CB1). Calculado en runtime */
  block_id?: string
}

export type NegocioBloque = {
  id: string
  negocio_id: string
  bloque_config_id: string
  estado: 'pendiente' | 'completo'
  data: Record<string, unknown> | null
  completado_at?: string | null
  completado_por?: string | null
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
  // Cierre modelo roles-areas-stages
  cierre_motivo: 'exitoso' | 'perdido' | 'cancelado' | null
  razon_cierre: string | null
  descripcion_cierre: string | null
  responsable_id: string | null
  // Pausa
  pausado: boolean
  pausado_hasta: string | null
  motivo_pausa: string | null
  motivo_pausa_detalle: string | null
  veces_pausado: number
  ultimo_pausado_at: string | null
  // Joins — usando columnas reales de las tablas existentes (empresas.nombre, contactos.nombre)
  lineas_negocio: { nombre: string; numero: number } | null
  etapas_negocio: { nombre: string; stage: string; numero: number } | null
  empresas: { id: string; nombre: string } | null
  contactos: { id: string; nombre: string } | null
  responsable: { id: string; full_name: string } | null
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
  linea_numero: number | null
  etapa_nombre: string | null
  etapa_numero: number | null
  etapa_stage: string | null
  empresa_nombre: string | null
  contacto_nombre: string | null
  // Ejecucion
  costos_ejecutados: number
  // Pausa
  pausado: boolean
  pausado_hasta: string | null
  motivo_pausa: string | null
  // Cierre (modelo roles-areas-stages Fase 3+)
  cierre_motivo: 'exitoso' | 'perdido' | 'cancelado' | null
  closed_at: string | null
  razon_cierre: string | null
  // Tarjeta config-driven (config_extra.negocio_card) — null en ws sin config
  vehiculo_label: string | null
  seccional_label: string | null
}

// Helper: cast Supabase client a untyped para tablas nuevas no en database.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

/** Compute initial data defaults from bloque_config config_extra.fields */
function computeFieldDefaults(configExtra: Record<string, unknown> | null): Record<string, unknown> {
  const fields = ((configExtra?.fields ?? []) as Array<{ slug: string; tipo?: string; default?: unknown }>)
  const defaults: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.default !== undefined) {
      defaults[f.slug] = f.default
    }
  }
  return defaults
}

// ── Listar negocios del workspace ─────────────────────────────────────────────

export async function getNegociosV2(
  estado: 'abierto' | 'completado' | 'todos' = 'abierto',
  incluirPausados = false,
): Promise<NegocioResumen[]> {
  const { supabase, workspaceId, userId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  // ── Modelo roles-areas-stages Fase 2: filtrado por operator ──
  // Operator solo ve negocios donde es responsable (negocio_responsables N:M).
  // Otros roles (owner/admin/supervisor/read_only) ven todos. Contador no llega aqui.
  let negocioIdsPermitidos: string[] | null = null
  if (role === 'operator' && staffId) {
    const { data: nrRows } = await db(supabase)
      .from('negocio_responsables')
      .select('negocio_id')
      .eq('staff_id', staffId)
    const ids = (nrRows ?? []).map((r: { negocio_id: string }) => r.negocio_id)
    if (ids.length === 0) return []
    negocioIdsPermitidos = ids
  }
  // userId unused outside future filters
  void userId

  let query = db(supabase)
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
      pausado,
      pausado_hasta,
      motivo_pausa,
      cierre_motivo,
      closed_at,
      razon_cierre,
      lineas_negocio(nombre, numero),
      etapas_negocio(nombre, stage, numero),
      empresas(nombre),
      contactos(nombre)
    `)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (estado !== 'todos') {
    query = query.eq('estado', estado)
  }
  if (!incluirPausados) {
    query = query.eq('pausado', false)
  }
  if (negocioIdsPermitidos) {
    query = query.in('id', negocioIdsPermitidos)
  }

  const { data } = await query

  if (!data) return []

  // Batch: gastos por negocio
  const negocioIds = (data as Record<string, unknown>[]).map(r => r.id as string)
  const [gastosRes, horasRes, staffRes, wsRes] = await Promise.all([
    db(supabase).from('gastos').select('negocio_id, monto').eq('workspace_id', workspaceId).in('negocio_id', negocioIds),
    db(supabase).from('horas').select('negocio_id, horas, staff_id').eq('workspace_id', workspaceId).in('negocio_id', negocioIds),
    supabase.from('staff').select('id, salary').eq('workspace_id', workspaceId),
    db(supabase).from('workspaces').select('config_extra').eq('id', workspaceId).single(),
  ])

  // Staff salary map for hour cost calculation
  const staffSalaryMap: Record<string, number> = {}
  for (const s of ((staffRes.data ?? []) as Array<{ id: string; salary: number | null }>)) {
    staffSalaryMap[s.id] = s.salary ?? 0
  }

  // Sum gastos per negocio
  const gastosPorNeg: Record<string, number> = {}
  for (const g of ((gastosRes.data ?? []) as Array<{ negocio_id: string; monto: number }>)) {
    gastosPorNeg[g.negocio_id] = (gastosPorNeg[g.negocio_id] ?? 0) + (g.monto ?? 0)
  }

  // Sum horas cost per negocio
  const horasCostoPorNeg: Record<string, number> = {}
  for (const h of ((horasRes.data ?? []) as Array<{ negocio_id: string; horas: number; staff_id: string | null }>)) {
    const salary = h.staff_id ? (staffSalaryMap[h.staff_id] ?? 0) : 0
    const tarifa = salary > 0 ? salary / 160 : 0
    horasCostoPorNeg[h.negocio_id] = (horasCostoPorNeg[h.negocio_id] ?? 0) + ((h.horas ?? 0) * tarifa)
  }

  // ── Tarjeta config-driven: vehículo + seccional desde un bloque (ej. Factura) ──
  // config_extra.negocio_card = { vehiculo_bloque, vehiculo_campos[], ciudad_campo }
  // Solo workspaces con ese config (ej. SOENA) lo llenan; el resto queda null.
  const cardCfg = ((wsRes.data as { config_extra?: Record<string, unknown> } | null)
    ?.config_extra?.negocio_card) as
    { vehiculo_bloque?: string; vehiculo_campos?: string[]; ciudad_campo?: string } | undefined
  const vehiculoPorNeg: Record<string, { label: string | null; seccional: string | null }> = {}
  if (cardCfg?.vehiculo_bloque && negocioIds.length > 0) {
    const getVal = (bdata: Record<string, unknown>, slug: string): string | null => {
      const campos = (bdata.campos as Record<string, { value?: unknown }> | undefined) ?? null
      const v = campos?.[slug]?.value ?? bdata[slug]
      const s = v == null ? '' : String(v).trim()
      return s || null
    }
    const { data: factBloques } = await db(supabase)
      .from('negocio_bloques')
      .select('negocio_id, data, bloque_configs!inner(nombre)')
      .in('negocio_id', negocioIds)
      .eq('bloque_configs.nombre', cardCfg.vehiculo_bloque)
    for (const row of ((factBloques ?? []) as Record<string, unknown>[])) {
      const negId = row.negocio_id as string
      const bdata = (row.data as Record<string, unknown>) ?? {}
      const parts = (cardCfg.vehiculo_campos ?? [])
        .map(slug => getVal(bdata, slug))
        .filter(Boolean) as string[]
      const label = parts.length ? parts.join(' ') : null
      const ciudad = cardCfg.ciudad_campo ? getVal(bdata, cardCfg.ciudad_campo) : null
      // SOENA = 100% personas naturales; para Bogotá esto resuelve a la seccional de naturales.
      const seccional = ciudad ? (mapCiudadASeccional(ciudad, 'natural')?.label ?? null) : null
      // El bloque origen (Validación) es el único con data extraída; si llega una
      // instancia heredada vacía, no se pisa un label/seccional ya resuelto.
      const prev = vehiculoPorNeg[negId]
      vehiculoPorNeg[negId] = {
        label: label ?? prev?.label ?? null,
        seccional: seccional ?? prev?.seccional ?? null,
      }
    }
  }

  return (data as Record<string, unknown>[]).map(row => {
    const id = row.id as string
    return {
      id,
      nombre: row.nombre as string,
      codigo: row.codigo as string | null,
      precio_estimado: row.precio_estimado as number | null,
      precio_aprobado: row.precio_aprobado as number | null,
      carpeta_url: row.carpeta_url as string | null,
      stage_actual: row.stage_actual as 'venta' | 'ejecucion' | 'cobro' | null,
      estado: row.estado as string | null,
      created_at: row.created_at as string | null,
      linea_nombre: (row.lineas_negocio as { nombre: string; numero: number } | null)?.nombre ?? null,
      linea_numero: (row.lineas_negocio as { nombre: string; numero: number } | null)?.numero ?? null,
      etapa_nombre: (row.etapas_negocio as { nombre: string; stage: string; numero: number } | null)?.nombre ?? null,
      etapa_numero: (row.etapas_negocio as { nombre: string; stage: string; numero: number } | null)?.numero ?? null,
      etapa_stage: (row.etapas_negocio as { nombre: string; stage: string; numero: number } | null)?.stage ?? null,
      empresa_nombre: (row.empresas as { nombre: string } | null)?.nombre ?? null,
      contacto_nombre: (row.contactos as { nombre: string } | null)?.nombre ?? null,
      costos_ejecutados: Math.round((gastosPorNeg[id] ?? 0) + (horasCostoPorNeg[id] ?? 0)),
      pausado: (row.pausado as boolean) ?? false,
      pausado_hasta: (row.pausado_hasta as string) ?? null,
      motivo_pausa: (row.motivo_pausa as string) ?? null,
      cierre_motivo: (row.cierre_motivo as 'exitoso' | 'perdido' | 'cancelado' | null) ?? null,
      closed_at: (row.closed_at as string) ?? null,
      razon_cierre: (row.razon_cierre as string) ?? null,
      vehiculo_label: vehiculoPorNeg[id]?.label ?? null,
      seccional_label: vehiculoPorNeg[id]?.seccional ?? null,
    }
  })
}

// ── Stages activos del workspace ─────────────────────────────────────────────

export async function getWorkspaceStagesActivos(): Promise<string[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return ['venta', 'ejecucion', 'cobro']

  const { data } = await db(supabase)
    .from('workspaces')
    .select('stages_activos')
    .eq('id', workspaceId)
    .single()

  const stages = (data as { stages_activos: string[] } | null)?.stages_activos
  return stages && Array.isArray(stages) && stages.length > 0
    ? stages
    : ['venta', 'ejecucion', 'cobro']
}

// ── Detalle de un negocio ─────────────────────────────────────────────────────

export async function getNegocioDetalle(id: string): Promise<{
  negocio: NegocioDetalle
  bloques: Array<BloqueConfig & { instancia: NegocioBloque | null }>
  etapasLinea: EtapaNegocio[]
  blockIdByConfigId: Record<string, string>
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
      cierre_motivo,
      razon_cierre,
      descripcion_cierre,
      responsable_id,
      pausado,
      pausado_hasta,
      motivo_pausa,
      motivo_pausa_detalle,
      veces_pausado,
      ultimo_pausado_at,
      lineas_negocio(nombre, numero),
      etapas_negocio(nombre, stage, numero),
      empresas(id, nombre),
      contactos(id, nombre),
      staff!negocios_responsable_id_fkey(id, full_name)
    `)
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .single()

  if (!negocio) return null

  // Map staff join to responsable field
  const negocioRaw = negocio as Record<string, unknown>
  const staffJoin = negocioRaw.staff as { id: string; full_name: string } | null
  const negocioTyped = {
    ...negocioRaw,
    responsable: staffJoin ?? null,
  } as unknown as NegocioDetalle

  // Cargar etapas de la línea para la barra de progreso
  let etapasLinea: EtapaNegocio[] = []
  if (negocioTyped.linea_id) {
    const { data: etapas } = await db(supabase)
      .from('etapas_negocio')
      .select('id, linea_id, stage, nombre, orden, numero')
      .eq('linea_id', negocioTyped.linea_id)
      .order('orden', { ascending: true })

    etapasLinea = ((etapas ?? []) as Record<string, unknown>[]).map(e => ({
      id: e.id as string,
      linea_id: e.linea_id as string,
      stage: e.stage as 'venta' | 'ejecucion' | 'cobro',
      nombre: e.nombre as string,
      orden: e.orden as number,
      numero: e.numero as number,
    }))
  }

  // Cargar bloque_configs de la etapa actual + negocio_bloques correspondientes
  let bloques: Array<BloqueConfig & { instancia: NegocioBloque | null }> = []
  const blockIdByConfigId = new Map<string, string>()
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
        config_extra,
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
        .select('id, negocio_id, bloque_config_id, estado, data, completado_at, completado_por')
        .eq('negocio_id', id)
        .in('bloque_config_id', configIds)

      for (const inst of ((instancias ?? []) as Record<string, unknown>[])) {
        instanciasMap[inst.bloque_config_id as string] = inst as unknown as NegocioBloque
      }

      // Auto-crear instancias faltantes (negocio creado antes de bloque_configs)
      const faltantes = configIds.filter(cid => !instanciasMap[cid])
      if (faltantes.length > 0) {
        // Bloques de solo lectura (config estado 'visible') no requieren acción
        // del usuario → nacen completos. El resto, pendiente.
        const configEstadoById = new Map(
          ((bloqueConfigs ?? []) as Array<{ id: string; estado?: string }>).map(bc => [bc.id, bc.estado])
        )
        const nuevas = faltantes.map(cid => {
          const esVisible = configEstadoById.get(cid) === 'visible'
          return {
            negocio_id: id,
            bloque_config_id: cid,
            estado: esVisible ? 'completo' : 'pendiente',
            data: {},
            ...(esVisible ? { completado_at: new Date().toISOString() } : {}),
          }
        })
        const { data: creadas } = await db(supabase)
          .from('negocio_bloques')
          .insert(nuevas)
          .select('id, negocio_id, bloque_config_id, estado, data')
        for (const inst of ((creadas ?? []) as Record<string, unknown>[])) {
          instanciasMap[inst.bloque_config_id as string] = inst as unknown as NegocioBloque
        }

      }

      // Auto-init de propuesta económica: si un bloque propuesta_economica ORIGEN
      // (con auto_propuesta.servicio_id) no tiene `precio_base_con_iva` en su data,
      // inicializarlo con el precio base del servicio. Cubre tanto instancias recién
      // creadas como EXISTENTES sin inicializar — p.ej. negocios que alcanzaron la
      // etapa antes de este fix, o si el init falló una vez. Antes esto solo ocurría
      // en crearNegocio (cuando Contacto era la 1ª etapa); tras mover Contacto
      // después de Validación debe poder dispararse al alcanzar la etapa.
      for (const bc of ((bloqueConfigs ?? []) as Array<{ id: string; config_extra?: Record<string, unknown> | null; bloque_definitions?: { tipo?: string } | null }>)) {
        if (bc.bloque_definitions?.tipo !== 'propuesta_economica') continue
        if ((bc.config_extra as { source_etapa_orden?: unknown } | null)?.source_etapa_orden !== undefined) continue
        const autoProp = (bc.config_extra?.auto_propuesta ?? null) as { servicio_id?: string } | null
        if (!autoProp?.servicio_id) continue
        const inst = instanciasMap[bc.id]
        if (!inst || (inst.data as Record<string, unknown> | null)?.precio_base_con_iva !== undefined) continue
        try {
          const { crearV1Automatica } = await import('@/lib/actions/propuesta-economica-actions')
          await crearV1Automatica(inst.id, autoProp.servicio_id)
          const { data: refreshed } = await db(supabase).from('negocio_bloques').select('data').eq('id', inst.id).single()
          if (refreshed) instanciasMap[bc.id] = { ...inst, data: (refreshed as { data: unknown }).data } as NegocioBloque
        } catch (e) {
          console.error('[getNegocioDetalle] auto-init propuesta económica falló:', e)
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

    // Calcular block_id por linea con herencia: los bloques readonly
    // que tienen source_etapa_orden mantienen el ID del bloque origen
    // (matching por nombre + tipo en la etapa source).
    if (negocioTyped.linea_id) {
      const { data: allLineaBlocks } = await db(supabase)
        .from('bloque_configs')
        .select(`
          id,
          etapa_id,
          orden,
          nombre,
          config_extra,
          bloque_definitions(tipo, nombre)
        `)
        .eq('workspace_id', workspaceId)

      type AllRow = {
        id: string
        etapa_id: string
        orden: number
        nombre: string | null
        config_extra: Record<string, unknown> | null
        bloque_definitions: { tipo: string; nombre: string } | null
      }
      const allRows = (allLineaBlocks ?? []) as unknown as AllRow[]
      const etapaIdsLinea = new Set(etapasLinea.map(e => e.id))
      const filtered = allRows.filter(r => etapaIdsLinea.has(r.etapa_id))
      const etapaOrdenById = new Map(etapasLinea.map(e => [e.id, e.orden]))
      const etapaIdByOrden = new Map(etapasLinea.map(e => [e.orden, e.id]))
      filtered.sort((a, b) => {
        const ea = etapaOrdenById.get(a.etapa_id) ?? 0
        const eb = etapaOrdenById.get(b.etapa_id) ?? 0
        if (ea !== eb) return ea - eb
        return a.orden - b.orden
      })

      // Primera pasada: asignar ID a bloques originales (sin source_etapa_orden).
      // Segunda pasada: heredar ID en bloques readonly que apuntan a un origen.
      const counters = new Map<string, number>()
      const nombreOf = (r: AllRow): string =>
        (r.nombre && r.nombre.trim().length > 0 ? r.nombre : r.bloque_definitions?.nombre ?? '').trim().toLowerCase()
      const tipoOf = (r: AllRow): string => r.bloque_definitions?.tipo ?? 'desconocido'

      // Indice por (etapa_id, nombre_lower, tipo) → row, para matching de herencia
      const indexByEtapaNombreTipo = new Map<string, AllRow>()
      const keyFor = (etapaId: string, nombre: string, tipo: string): string =>
        `${etapaId}::${nombre}::${tipo}`
      for (const row of filtered) {
        indexByEtapaNombreTipo.set(keyFor(row.etapa_id, nombreOf(row), tipoOf(row)), row)
      }

      // Pasada 1: originales (sin source_etapa_orden)
      for (const row of filtered) {
        const srcOrden = (row.config_extra as { source_etapa_orden?: number } | null)?.source_etapa_orden
        if (typeof srcOrden === 'number') continue
        const code = bloqueTipoCode(tipoOf(row))
        const n = (counters.get(code) ?? 0) + 1
        counters.set(code, n)
        blockIdByConfigId.set(row.id, `${code}${n}`)
      }

      // Pasada 2: heredados — buscar origen por (etapa source, nombre, tipo)
      for (const row of filtered) {
        const srcOrden = (row.config_extra as { source_etapa_orden?: number } | null)?.source_etapa_orden
        if (typeof srcOrden !== 'number') continue
        const srcEtapaId = etapaIdByOrden.get(srcOrden)
        let originId: string | undefined
        if (srcEtapaId) {
          const match = indexByEtapaNombreTipo.get(keyFor(srcEtapaId, nombreOf(row), tipoOf(row)))
          if (match) originId = blockIdByConfigId.get(match.id)
        }
        if (originId) {
          blockIdByConfigId.set(row.id, originId)
        } else {
          // Fallback: no se encontro origen — asignar nuevo ID para no romper
          const code = bloqueTipoCode(tipoOf(row))
          const n = (counters.get(code) ?? 0) + 1
          counters.set(code, n)
          blockIdByConfigId.set(row.id, `${code}${n}`)
        }
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
      nombre: (bc.nombre as string | null) ?? null,
      bloque_definitions: bc.bloque_definitions as BloqueDefinition | null,
      instancia: instanciasMap[bc.id as string] ?? null,
      block_id: blockIdByConfigId.get(bc.id as string),
    }))
  }

  return {
    negocio: negocioTyped,
    bloques,
    etapasLinea,
    blockIdByConfigId: Object.fromEntries(blockIdByConfigId),
  }
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
      .select('id, workspace_id, nombre, tipo, numero')
      .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
      .order('numero', { ascending: true }),
  ])

  return {
    empresas: (empresasRes.data ?? []) as { id: string; nombre: string }[],
    contactos: (contactosRes.data ?? []) as { id: string; nombre: string }[],
    lineas: ((lineasRes.data ?? []) as Record<string, unknown>[]).map(l => ({
      id: l.id as string,
      workspace_id: l.workspace_id as string | null,
      nombre: l.nombre as string,
      tipo: l.tipo as 'plantilla' | 'clarity',
      numero: l.numero as number,
    })),
  }
}

// ── Crear negocio ─────────────────────────────────────────────────────────────

export async function crearNegocio(input: {
  nombre: string
  linea_id?: string
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

  // Get workspace config: stages_activos + linea_activa_id + config_extra
  const { data: wsConfig } = await db(supabase)
    .from('workspaces')
    .select('stages_activos, linea_activa_id, config_extra')
    .eq('id', workspaceId)
    .single()

  // Use linea_activa_id if no linea provided
  const lineaId = input.linea_id ?? (wsConfig as { stages_activos: string[]; linea_activa_id: string | null } | null)?.linea_activa_id
  if (!lineaId) return { negocio_id: null, error: 'No hay línea de negocio configurada' }

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
          codigo: '', // trigger auto-genera
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

  // Obtener primera etapa filtrada por stages activos del workspace
  const stagesActivos = (wsConfig as { stages_activos: string[] } | null)?.stages_activos ?? ['venta', 'ejecucion', 'cobro']
  const { data: primeraEtapaRaw } = await db(supabase)
    .from('etapas_negocio')
    .select('id, stage')
    .eq('linea_id', lineaId)
    .in('stage', stagesActivos)
    .order('orden', { ascending: true })
    .limit(1)
    .single()

  const primeraEtapa = primeraEtapaRaw as { id: string; stage: string } | null

  // Auto-nombre = contacto (config-driven POR LÍNEA). La regla vive en
  // config_extra.negocio_codigo_format[{linea_id, nombre_auto}] — la misma que
  // define el folio (ej. SOENA/VE → V0001 + nombre = cliente).
  let nombreNegocio = input.nombre
  const codigoFormat = (wsConfig as { config_extra?: Record<string, unknown> } | null)
    ?.config_extra?.negocio_codigo_format as Array<{ linea_id?: string; nombre_auto?: string }> | undefined
  const reglaLinea = Array.isArray(codigoFormat)
    ? codigoFormat.find(r => r.linea_id === lineaId)
    : undefined
  if (reglaLinea?.nombre_auto === 'contacto' && contactoId) {
    if (input.contacto_nombre?.trim()) {
      nombreNegocio = input.contacto_nombre.trim()
    } else {
      const { data: c } = await supabase.from('contactos').select('nombre').eq('id', contactoId).single()
      if (c?.nombre) nombreNegocio = c.nombre
    }
  }

  const { data: negocio, error: insertError } = await db(supabase)
    .from('negocios')
    .insert({
      workspace_id: workspaceId,
      nombre: nombreNegocio,
      linea_id: lineaId,
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

  // ── Auto-crear carpeta en Google Drive ──
  // Prioridad: linea.drive_folder_id → workspaces.drive_folder_id (fallback)
  // El fallback workspace permite que workspaces con lineas-plantilla globales
  // (workspace_id NULL) auto-creen carpetas sin tener que clonar la linea.
  try {
    const { data: lineaDrive } = await db(supabase)
      .from('lineas_negocio')
      .select('drive_folder_id')
      .eq('id', lineaId)
      .single()

    let driveFolderId = (lineaDrive as { drive_folder_id: string | null } | null)?.drive_folder_id

    if (!driveFolderId) {
      const { data: wsData } = await db(supabase)
        .from('workspaces')
        .select('drive_folder_id')
        .eq('id', workspaceId)
        .single()
      driveFolderId = (wsData as { drive_folder_id: string | null } | null)?.drive_folder_id
    }

    if (driveFolderId) {
      // Obtener codigo auto-generado + nombre del cliente
      const { data: negocioCreado } = await db(supabase)
        .from('negocios')
        .select('codigo, empresas(nombre), contactos(nombre)')
        .eq('id', negocioData.id)
        .single()

      const neg = negocioCreado as {
        codigo: string | null
        empresas: { nombre: string } | null
        contactos: { nombre: string } | null
      } | null

      const codigo = neg?.codigo ?? negocioData.id.slice(0, 8)
      const clienteNombre = neg?.empresas?.nombre ?? neg?.contactos?.nombre ?? input.nombre
      const folderName = `${codigo} - ${clienteNombre}`

      const folderId = await createDriveFolder(folderName, driveFolderId, workspaceId)
      const folderUrl = `https://drive.google.com/drive/folders/${folderId}`

      // Pre-crear estructura canonica de subcarpetas — el operador y el cliente
      // ven los compartimentos desde el primer dia, aunque no haya archivos.
      const CARPETAS_INICIALES = [
        '1. Legal',
        '2. Comercial',
        '3. UPME',
        '4. DIAN',
        '5. Otros',
      ]
      for (const carpeta of CARPETAS_INICIALES) {
        try {
          await createDriveFolder(carpeta, folderId, workspaceId)
        } catch (err) {
          // No bloquea creacion del negocio si una subcarpeta falla
          console.warn(`[crearNegocio] no se pudo pre-crear "${carpeta}":`, err instanceof Error ? err.message : err)
        }
      }

      // Guardar link en el negocio
      await db(supabase)
        .from('negocios')
        .update({ carpeta_url: folderUrl })
        .eq('id', negocioData.id)
    }
  } catch (driveErr) {
    // No bloquear la creación del negocio si Drive falla, pero log explicito
    // + registro en activity_log para que sea visible al owner sin tener que
    // mirar logs de Vercel. Detectado tras incidente SOENA 2026-05-24 donde
    // las carpetas dejaron de crearse silenciosamente al revocarse el OAuth.
    const msg = driveErr instanceof Error ? driveErr.message : String(driveErr)
    console.error(
      `[crearNegocio] Error creando carpeta Drive (workspace=${workspaceId}, negocio=${negocioData.id}, linea=${lineaId}):`,
      msg,
    )
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('activity_log').insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioData.id,
        tipo: 'drive_folder_failed',
        contenido: `Error creando carpeta en Drive: ${msg.slice(0, 500)}`,
      })
    } catch (logErr) {
      console.error('[crearNegocio] No se pudo registrar drive_folder_failed en activity_log:', logErr)
    }
  }

  // Crear negocio_bloques para cada bloque_config de la primera etapa
  if (primeraEtapa?.id) {
    const { data: bloqueConfigs } = await db(supabase)
      .from('bloque_configs')
      .select('id, estado, config_extra, bloque_definitions(tipo)')
      .eq('etapa_id', primeraEtapa.id)
      .eq('workspace_id', workspaceId)

    if (bloqueConfigs && (bloqueConfigs as Record<string, unknown>[]).length > 0) {
      const instancias = (bloqueConfigs as Record<string, unknown>[]).map(bc => {
        const defaults = computeFieldDefaults(bc.config_extra as Record<string, unknown> | null)
        // Bloques de solo lectura (config estado 'visible') no requieren acción
        // del usuario → nacen completos. El resto, pendiente.
        const esVisible = bc.estado === 'visible'
        return {
          negocio_id: negocioData.id,
          bloque_config_id: bc.id as string,
          estado: esVisible ? 'completo' : 'pendiente',
          data: Object.keys(defaults).length > 0 ? defaults : {},
          ...(esVisible ? { completado_at: new Date().toISOString() } : {}),
        }
      })

      await db(supabase).from('negocio_bloques').insert(instancias)

      // ── Auto-cotización: si algún bloque cotización tiene config auto_cotizacion ──
      // Prioridad de lookup: servicio_id (estable a renames) > servicio_nombre (legacy)
      for (const bc of bloqueConfigs as Array<{
        id: string
        config_extra: Record<string, unknown> | null
        bloque_definitions: { tipo: string } | null
      }>) {
        const tipoBd = bc.bloque_definitions?.tipo
        const autoCot = (bc.config_extra?.auto_cotizacion ?? null) as {
          servicio_id?: string
          servicio_nombre?: string
          usar_precio_estimado?: boolean
        } | null

        if (tipoBd === 'cotizacion' && autoCot && (autoCot.servicio_id || autoCot.servicio_nombre)) {
          await crearCotizacionAutomatica(
            supabase,
            workspaceId,
            negocioData.id,
            { servicio_id: autoCot.servicio_id, servicio_nombre: autoCot.servicio_nombre },
            autoCot.usar_precio_estimado ? (input.precio_estimado ?? 0) : 0
          )
        }

        // ── Auto-init propuesta_economica con precio base del servicio ──
        const autoProp = (bc.config_extra?.auto_propuesta ?? null) as {
          servicio_id?: string
        } | null
        if (tipoBd === 'propuesta_economica' && autoProp?.servicio_id) {
          try {
            const { data: instanciaRow } = await db(supabase)
              .from('negocio_bloques')
              .select('id')
              .eq('negocio_id', negocioData.id)
              .eq('bloque_config_id', bc.id)
              .single()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const inst = instanciaRow as any
            if (inst?.id) {
              const { crearV1Automatica } = await import('@/lib/actions/propuesta-economica-actions')
              await crearV1Automatica(inst.id, autoProp.servicio_id)
            }
          } catch (e) {
            console.error(
              `[crearNegocio] Error auto-init propuesta_economica (bloque_config=${bc.id}):`,
              e instanceof Error ? e.message : String(e),
            )
          }
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


type SupabaseClient = Awaited<ReturnType<typeof import('@/lib/actions/get-workspace').getWorkspace>>['supabase']

async function crearCotizacionAutomatica(
  supabase: SupabaseClient,
  workspaceId: string,
  negocioId: string,
  lookup: { servicio_id?: string; servicio_nombre?: string },
  precioEstimado: number
) {
  // 1. Obtener consecutivo
  const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  const consecutivo = consecutivoRaw ?? `COT-${bogotaYear()}-${Date.now()}`

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

  // 3. Buscar servicio por ID (preferido) o por nombre (legacy)
  let servicioQuery = supabase
    .from('servicios')
    .select('id, nombre, precio_estandar, rubros_template')
    .eq('workspace_id', workspaceId)
    .eq('activo', true)
    .limit(1)
  if (lookup.servicio_id) {
    servicioQuery = servicioQuery.eq('id', lookup.servicio_id)
  } else if (lookup.servicio_nombre) {
    servicioQuery = servicioQuery.ilike('nombre', lookup.servicio_nombre)
  } else {
    return
  }
  const { data: servicio } = await servicioQuery.single()

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
  if (precioEstimado === 0 && (servicio.precio_estandar ?? 0) > 0) {
    await supabase
      .from('cotizaciones')
      .update({ valor_total: servicio.precio_estandar ?? 0 })
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
    .select('id, bloque_definition_id, estado, nombre, config_extra, bloque_definitions(tipo)')
    .eq('etapa_id', nuevaEtapaId)
    .eq('workspace_id', workspaceId)

  if (bloqueConfigs && (bloqueConfigs as Record<string, unknown>[]).length > 0) {
    const typedConfigs = bloqueConfigs as Array<{
      id: string
      bloque_definition_id: string
      estado: string
      nombre: string | null
      config_extra: Record<string, unknown> | null
      bloque_definitions: { tipo: string } | null
    }>
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
      .select('id, estado, data, completado_at, bloque_configs(bloque_definition_id, nombre, config_extra, bloque_definitions(tipo))')
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

    // Mapa adicional para tipos que comparten bloque_definition_id:
    // - documento: keyed por {definition_id}:{config_extra.label}
    // - datos: keyed por {definition_id}:{bloque_configs.nombre}
    const completadosPorLabel = new Map<string, { id: string; data: Record<string, unknown>; completado_at: string | null }>()
    for (const c of ((completadosRaw ?? []) as Record<string, unknown>[])) {
      const config = c.bloque_configs as Record<string, unknown> | null
      const defId = config?.bloque_definition_id as string | null
      const tipo = (config?.bloque_definitions as Record<string, unknown> | null)?.tipo as string | null
      const entry = {
        id: c.id as string,
        data: (c.data ?? {}) as Record<string, unknown>,
        completado_at: c.completado_at as string | null,
      }
      if (tipo === 'documento' && defId) {
        const label = (config?.config_extra as Record<string, unknown> | null)?.label as string | null
        if (label) completadosPorLabel.set(`${defId}:${label}`, entry)
      }
      if (tipo === 'datos' && defId) {
        const nombre = config?.nombre as string | null
        if (nombre) completadosPorLabel.set(`${defId}:${nombre}`, entry)
      }
    }

    const nuevas = typedConfigs
      .filter(bc => !existingIds.has(bc.id))
      .map(bc => {
        const isVisible = bc.estado === 'visible'
        const tipo = bc.bloque_definitions?.tipo
        const isDocumento = tipo === 'documento'
        const isDatos = tipo === 'datos'

        let prevCompleto
        if (isVisible) {
          // Datos and documento share definition_id — use nombre/label for disambiguation
          if (isDatos && bc.nombre) {
            prevCompleto = completadosPorLabel.get(`${bc.bloque_definition_id}:${bc.nombre}`)
          }
          if (!prevCompleto) {
            prevCompleto = completadosPorDef.get(bc.bloque_definition_id)
          }
        } else if (isDocumento) {
          // Documento blocks: match by label across etapas (all share same definition_id)
          const label = (bc.config_extra as Record<string, unknown> | null)?.label as string | null
          if (label) {
            prevCompleto = completadosPorLabel.get(`${bc.bloque_definition_id}:${label}`)
          }
        } else if (tipo === 'cotizacion') {
          // Cotización: inherit completion state across etapas (unique definition_id)
          prevCompleto = completadosPorDef.get(bc.bloque_definition_id)
        }

        // If no inherited data, initialize with field defaults from config
        const data = prevCompleto?.data
          ?? (isDatos ? computeFieldDefaults(bc.config_extra as Record<string, unknown> | null) : {})

        return {
          negocio_id: negocioId,
          bloque_config_id: bc.id,
          estado: prevCompleto ? 'completo' : 'pendiente',
          data,
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
      conditional?: Array<{ condition: { field: string; value: string }; etapa_orden: number }>
      // Opcional: leer los campos desde una etapa distinta a la actual.
      // Util cuando el flag decisorio se configura en una etapa anterior
      // (ej: flag de devolucion IVA en etapa 2, evaluado al salir de la 6).
      source_etapa_orden?: number
    } | null

    if (routing) {
      // Resolver qué etapa usar como fuente de datos para las condiciones
      let sourceEtapaId: string = negocio.etapa_actual_id
      if (typeof routing.source_etapa_orden === 'number') {
        const { data: sourceEtapa } = await db(supabase)
          .from('etapas_negocio')
          .select('id')
          .eq('linea_id', etapaActualData.linea_id)
          .eq('orden', routing.source_etapa_orden)
          .single()
        if (sourceEtapa) sourceEtapaId = (sourceEtapa as { id: string }).id
      }

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
        .eq('bloque_configs.etapa_id', sourceEtapaId)

      const camposNegocio: Record<string, unknown> = {}
      for (const b of ((bloquesDatos ?? []) as Record<string, unknown>[])) {
        const tipo = ((b.bloque_configs as Record<string, unknown>)?.bloque_definitions as Record<string, unknown> | null)?.tipo
        if (tipo === 'datos' && b.data && typeof b.data === 'object') {
          Object.assign(camposNegocio, b.data)
        }
      }

      // Evaluar condicionales — primer match gana
      let etapaOrdenDestino = routing.default_etapa_orden
      for (const rule of (routing.conditional ?? [])) {
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
      // Listar SOLO los bloques gate que realmente bloquean (pendientes +
      // condición cumplida) — misma lógica que puede_avanzar_etapa, vía
      // gates_pendientes_etapa. Antes se listaban TODOS los es_gate de la etapa,
      // incluidos los ya completos, lo que confundía al usuario.
      const { data: pendientesRaw } = await db(supabase)
        .rpc('gates_pendientes_etapa', {
          p_negocio_id: negocioId,
          p_etapa_id: negocio.etapa_actual_id,
        })

      const bloquesPendientes = ((pendientesRaw ?? []) as Array<{ nombre: string | null }>).map(
        (b) => ({ nombre: b.nombre ?? 'Bloque', es_gate: true })
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

    // Gate custom: saldo_cero — saldo del negocio debe ser cero para avanzar
    if (etapaGates.includes('saldo_cero')) {
      const [negPrecioRes, cobrosRes] = await Promise.all([
        db(supabase)
          .from('negocios')
          .select('precio_aprobado, precio_estimado')
          .eq('id', negocioId)
          .single(),
        supabase
          .from('cobros')
          .select('monto')
          .eq('negocio_id', negocioId)
          .eq('workspace_id', workspaceId)
          ,
      ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const negPrecio = negPrecioRes.data as any
      const precio = negPrecio?.precio_aprobado ?? negPrecio?.precio_estimado ?? 0
      const totalCobrado = ((cobrosRes.data ?? []) as Array<{ monto: number }>)
        .reduce((sum, c) => sum + (c.monto ?? 0), 0)
      const saldo = precio - totalCobrado

      if (saldo > 0) {
        const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
        return {
          error: 'gate_bloqueado',
          bloquesPendientes: [{ nombre: `Saldo pendiente: ${fmt.format(saldo)}`, es_gate: true }],
        }
      }
    }

    // Gate custom genérico: campo:<slug>=<valor> — un campo de un bloque `datos`
    // de la etapa actual debe tener un valor específico para poder avanzar.
    // Reusable por config de etapa (etapas_negocio.config_extra.gates), con mensaje
    // opcional en config_extra.gate_messages[gate]. Ej: "campo:decision_incluir=si".
    const camposGates = etapaGates.filter((g) => g.startsWith('campo:'))
    if (camposGates.length > 0) {
      const { data: bloquesDatosActual } = await db(supabase)
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

      const camposActual: Record<string, unknown> = {}
      for (const b of ((bloquesDatosActual ?? []) as Record<string, unknown>[])) {
        const tipo = ((b.bloque_configs as Record<string, unknown>)?.bloque_definitions as Record<string, unknown> | null)?.tipo
        if (tipo === 'datos' && b.data && typeof b.data === 'object') {
          Object.assign(camposActual, b.data)
        }
      }

      const gateMessages = (etapaActualConfigExtra.gate_messages ?? {}) as Record<string, string>
      for (const gate of camposGates) {
        const rest = gate.slice('campo:'.length)
        const eqIdx = rest.indexOf('=')
        if (eqIdx === -1) continue
        const slug = rest.slice(0, eqIdx)
        const expected = rest.slice(eqIdx + 1)
        const actual = camposActual[slug]
        const actualStr = typeof actual === 'boolean' ? String(actual) : String(actual ?? '')
        if (actualStr !== expected) {
          const nombre = gateMessages[gate] ?? `Campo "${slug}" debe ser "${expected}"`
          return { error: 'gate_bloqueado', bloquesPendientes: [{ nombre, es_gate: true }] }
        }
      }
    }

    // Gate custom: sobrepago_conciliado — si el total cobrado supera el precio del
    // negocio, exige que el sobrepago esté conciliado (campo `accion_extra` con valor).
    // Si no hay sobrepago, no exige nada (no estorba a negocios con pago normal).
    if (etapaGates.includes('sobrepago_conciliado')) {
      const [negPrecioConcRes, cobrosConcRes] = await Promise.all([
        db(supabase).from('negocios').select('precio_aprobado, precio_estimado').eq('id', negocioId).single(),
        supabase.from('cobros').select('monto').eq('negocio_id', negocioId),
      ])
      const negPrecioConc = negPrecioConcRes.data as { precio_aprobado: number | null; precio_estimado: number | null } | null
      const precioConc = negPrecioConc?.precio_aprobado ?? negPrecioConc?.precio_estimado ?? 0
      const totalCobradoConc = ((cobrosConcRes.data ?? []) as Array<{ monto: number }>)
        .reduce((sum, c) => sum + (c.monto ?? 0), 0)
      const extra = totalCobradoConc - precioConc

      if (precioConc > 0 && extra > 0) {
        const { data: bloquesConc } = await db(supabase)
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

        const camposConc: Record<string, unknown> = {}
        for (const b of ((bloquesConc ?? []) as Record<string, unknown>[])) {
          const tipo = ((b.bloque_configs as Record<string, unknown>)?.bloque_definitions as Record<string, unknown> | null)?.tipo
          if (tipo === 'datos' && b.data && typeof b.data === 'object') {
            Object.assign(camposConc, b.data)
          }
        }
        const accion = camposConc['accion_extra']
        if (accion == null || String(accion) === '') {
          const fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
          return {
            error: 'gate_bloqueado',
            bloquesPendientes: [{ nombre: `Concilia el sobrepago de ${fmt.format(extra)}`, es_gate: true }],
          }
        }
      }
    }
  }

  // Skip etapa cobro cuando el pago ya está saldado — si el destino tiene stage='cobro',
  // avanzar automáticamente a la siguiente etapa en orden. Si la etapa tiene
  // config_extra.conciliar_sobrepago=true, solo salta con pago EXACTO (saldo===0); un
  // sobrepago (saldo<0) NO salta y entra a Cobro para conciliar el extra.
  {
    const { data: destStageRaw } = await db(supabase)
      .from('etapas_negocio')
      .select('stage, orden, linea_id, config_extra')
      .eq('id', resolvedEtapaId)
      .single()
    const destStage = destStageRaw as { stage: string | null; orden: number; linea_id: string; config_extra: Record<string, unknown> | null } | null

    if (destStage?.stage === 'cobro') {
      const [negPrecioRes, cobrosSkipRes] = await Promise.all([
        db(supabase).from('negocios').select('precio_aprobado, precio_estimado').eq('id', negocioId).single(),
        supabase.from('cobros').select('monto').eq('negocio_id', negocioId),
      ])
      const negPrecio = negPrecioRes.data as { precio_aprobado: number | null; precio_estimado: number | null } | null
      const precio = negPrecio?.precio_aprobado ?? negPrecio?.precio_estimado ?? 0
      const totalCobrado = ((cobrosSkipRes.data ?? []) as Array<{ monto: number }>)
        .reduce((sum, c) => sum + (c.monto ?? 0), 0)
      const saldo = precio - totalCobrado
      const conciliarSobrepago = destStage.config_extra?.conciliar_sobrepago === true
      // Con conciliación activa el sobrepago NO salta (entra a conciliar). Sin ella, saldo<=0 salta.
      const debeSaltar = conciliarSobrepago ? saldo === 0 : saldo <= 0

      if (precio > 0 && debeSaltar) {
        const { data: nextEtapaRaw } = await db(supabase)
          .from('etapas_negocio')
          .select('id')
          .eq('linea_id', destStage.linea_id)
          .eq('orden', destStage.orden + 1)
          .single()
        if (nextEtapaRaw) {
          resolvedEtapaId = (nextEtapaRaw as { id: string }).id
        }
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

// ── Retroceder a etapa anterior ──────────────────────────────────────────────

/**
 * Retrocede el negocio a una etapa anterior preservando TODO el progreso.
 * No valida gates. No borra negocio_bloques ni datos. Solo cambia etapa_actual_id.
 * Registra el retroceso en activity_log.
 */
export async function retrocederEtapaNegocio(
  negocioId: string,
  etapaDestinoId: string,
  motivo?: string,
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const { data: negocioRaw } = await db(supabase)
    .from('negocios')
    .select('etapa_actual_id')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  const negocio = negocioRaw as { etapa_actual_id: string | null } | null
  if (!negocio?.etapa_actual_id) return { error: 'Negocio sin etapa actual' }

  const [actualRes, destinoRes] = await Promise.all([
    db(supabase).from('etapas_negocio').select('orden, linea_id, nombre').eq('id', negocio.etapa_actual_id).single(),
    db(supabase).from('etapas_negocio').select('orden, linea_id, stage, nombre').eq('id', etapaDestinoId).single(),
  ])

  const actual = actualRes.data as { orden: number; linea_id: string; nombre: string } | null
  const destino = destinoRes.data as { orden: number; linea_id: string; stage: string; nombre: string } | null
  if (!actual || !destino) return { error: 'Etapa no encontrada' }
  if (actual.linea_id !== destino.linea_id) return { error: 'Etapas de líneas distintas' }
  if (destino.orden >= actual.orden) return { error: 'La etapa destino debe ser anterior a la actual' }

  const { error: updateError } = await db(supabase)
    .from('negocios')
    .update({
      etapa_actual_id: etapaDestinoId,
      stage_actual: destino.stage,
      updated_at: new Date().toISOString(),
    })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updateError) return { error: (updateError as { message: string }).message }

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
        valor_anterior: actual.nombre,
        valor_nuevo: destino.nombre,
        contenido: motivo ? `Retroceso: ${motivo}` : 'Retroceso manual de etapa',
      })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null }
}

// ── Marcar bloque completo ─────────────────────────────────────────────────────

export async function marcarBloqueCompleto(
  negocioBloqueId: string,
  data: Record<string, unknown>
): Promise<{ error: string | null; trigger_afi_generation?: boolean; trigger_afi_contrato?: boolean; negocio_id?: string }> {
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
      completado_por: staffId ?? null,
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

    // ── Hook AFI: si es uno de los bloques accionables del workspace afi, señalar al cliente
    // que dispare el endpoint correspondiente (route handlers tienen maxDuration=60s).
    // Server actions no permiten export maxDuration, por eso no corremos el motor aqui.
    let trigger_afi_generation = false
    let trigger_afi_contrato = false
    if (tipo === 'datos' && bloque.bloque_configs?.nombre) {
      const nombre = bloque.bloque_configs.nombre
      if (nombre === 'Generar paquete' || nombre === 'Generar contrato') {
        const { data: ws } = await db(supabase)
          .from('workspaces').select('slug').eq('id', workspaceId as string).single()
        if ((ws as { slug: string } | null)?.slug === 'afi') {
          if (nombre === 'Generar paquete') trigger_afi_generation = true
          else if (nombre === 'Generar contrato') trigger_afi_contrato = true
        }
      }
    }
    if (trigger_afi_generation) {
      return { error: null, trigger_afi_generation: true, negocio_id: bloque.negocio_id }
    }
    if (trigger_afi_contrato) {
      return { error: null, trigger_afi_contrato: true, negocio_id: bloque.negocio_id }
    }

    // Registrar en activity_log con detalle de campos que cambiaron
    if (staffId && workspaceId) {
      const bloqueNombre = bloque.bloque_configs?.nombre ?? bloque.bloque_configs?.bloque_definitions?.nombre ?? 'Bloque'
      // Diff: detectar qué campos cambiaron respecto a los datos anteriores
      const changedFields: string[] = []
      for (const key of Object.keys(data)) {
        if (JSON.stringify(currentData[key]) !== JSON.stringify(data[key])) {
          changedFields.push(key)
        }
      }
      const detalle = changedFields.length > 0
        ? `Bloque "${bloqueNombre}" completado (${changedFields.join(', ')})`
        : `Bloque "${bloqueNombre}" completado`
      await supabase
        .from('activity_log')
        .insert({
          workspace_id: workspaceId,
          entidad_tipo: 'negocio',
          entidad_id: bloque.negocio_id,
          tipo: 'cambio',
          autor_id: staffId,
          campo_modificado: 'bloque_datos',
          contenido: detalle,
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
  const { supabase, error } = await getWorkspace()
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

  // No registrar en activity_log aquí — auto-save cada 800ms genera ruido.
  // Los cambios se registran al completar bloque (marcarBloqueCompleto).

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
    await reevaluarBloquesCobros(negocioId)
    revalidatePath(`/negocios/${negocioId}`)
    return { error: null }
  }

  const cobro = {
    workspace_id: workspaceId,
    negocio_id: negocioId,
    notas: 'Anticipo',
    monto: valorAnticipo,
    tipo_cobro: 'anticipo',
    fecha: todayBogotaISO(),
    external_ref: referenciaEpayco ?? null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (supabase as any).from('cobros').insert(cobro)
  if (insertError) return { error: (insertError as { message: string }).message }

  await reevaluarBloquesCobros(negocioId)
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
      notas: 'Pago',
      monto: p.valor_pago,
      tipo_cobro: 'pago',
        fecha: todayBogotaISO(),
      external_ref: p.referencia_epayco,
    }))

  if (nuevos.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: insertError } = await (supabase as any).from('cobros').insert(nuevos)
    if (insertError) return { error: (insertError as { message: string }).message }
  }

  await reevaluarBloquesCobros(negocioId)
  revalidatePath(`/negocios/${negocioId}`)
  return { error: null }
}

// ── Agregar un bloque_item (cronograma) ───────────────────────────────────────

export async function agregarBloqueItem(
  negocioBloqueId: string,
  label: string,
  tipo: string,
  orden: number,
  extra?: { fecha_inicio?: string | null; fecha_fin?: string | null; responsable_id?: string | null }
): Promise<{ id: string | null; error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { id: null, error: 'No autenticado' }

  const row: Record<string, unknown> = { negocio_bloque_id: negocioBloqueId, label, tipo, orden, completado: false, contenido: {} }
  if (extra?.fecha_inicio) row.fecha_inicio = extra.fecha_inicio
  if (extra?.fecha_fin) row.fecha_fin = extra.fecha_fin
  if (extra?.responsable_id) row.responsable_id = extra.responsable_id

  const { data, error: insertError } = await db(supabase)
    .from('bloque_items')
    .insert(row)
    .select('id')
    .single()

  if (insertError) return { id: null, error: (insertError as { message: string }).message }
  return { id: (data as { id: string }).id, error: null }
}

// ── Actualizar datos de un bloque_item ────────────────────────────────────────

export async function actualizarBloqueItem(
  bloqueItemId: string,
  fields: { label?: string; fecha_inicio?: string | null; fecha_fin?: string | null; link_url?: string | null; responsable_id?: string | null }
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

// ── Eliminar un bloque_item ──────────────────────────────────────────────────

export async function eliminarBloqueItem(
  bloqueItemId: string
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  const { error: delError } = await db(supabase)
    .from('bloque_items')
    .delete()
    .eq('id', bloqueItemId)

  if (delError) return { error: (delError as { message: string }).message }
  return { error: null }
}

// ── Re-evaluar completitud de bloques cobros del negocio ────────────────────
// Un bloque de cobros se considera completo cuando el saldo del negocio es 0
// (precio_aprobado/estimado - sum(cobros APROBADO|CAUSADO) <= 0).

export async function reevaluarBloquesCobros(
  negocioId: string
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  // Precio del negocio y cobros aprobados/causados en paralelo
  const [negocioRes, cobrosRes] = await Promise.all([
    db(supabase)
      .from('negocios')
      .select('precio_aprobado, precio_estimado')
      .eq('id', negocioId)
      .single(),
    supabase
      .from('cobros')
      .select('monto')
      .eq('negocio_id', negocioId)
      ,
  ])

  const neg = negocioRes.data as { precio_aprobado: number | null; precio_estimado: number | null } | null
  const precio = neg?.precio_aprobado ?? neg?.precio_estimado ?? 0
  const totalCobrado = ((cobrosRes.data ?? []) as Array<{ monto: number }>)
    .reduce((sum, c) => sum + (c.monto ?? 0), 0)
  const saldo = precio - totalCobrado
  const shouldBeComplete = precio > 0 && saldo <= 0

  // Buscar todas las instancias de bloques cobros del negocio
  const { data: bloquesRaw } = await db(supabase)
    .from('negocio_bloques')
    .select(`
      id,
      estado,
      bloque_configs!inner(
        bloque_definitions!inner(tipo)
      )
    `)
    .eq('negocio_id', negocioId)

  type BloqueRow = {
    id: string
    estado: string
    bloque_configs: { bloque_definitions: { tipo: string } | null } | null
  }
  const bloquesCobros = ((bloquesRaw ?? []) as BloqueRow[])
    .filter(b => b.bloque_configs?.bloque_definitions?.tipo === 'cobros')

  if (bloquesCobros.length === 0) return { error: null }

  const now = new Date().toISOString()
  const toComplete = bloquesCobros.filter(b => shouldBeComplete && b.estado !== 'completo').map(b => b.id)
  const toPending = bloquesCobros.filter(b => !shouldBeComplete && b.estado === 'completo').map(b => b.id)

  if (toComplete.length > 0) {
    await db(supabase)
      .from('negocio_bloques')
      .update({ estado: 'completo', completado_at: now, updated_at: now })
      .in('id', toComplete)
  }
  if (toPending.length > 0) {
    await db(supabase)
      .from('negocio_bloques')
      .update({ estado: 'pendiente', completado_at: null, updated_at: now })
      .in('id', toPending)
  }

  return { error: null }
}

// ── Re-evaluar completitud de bloque cronograma ─────────────────────────────

export async function reevaluarBloqueCronograma(
  negocioBloqueId: string,
  requireAllDates: boolean
): Promise<{ error: string | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { error: 'No autenticado' }

  // Leer items actuales
  const { data: itemsData } = await db(supabase)
    .from('bloque_items')
    .select('id, fecha_inicio, fecha_fin')
    .eq('negocio_bloque_id', negocioBloqueId)

  const items = (itemsData ?? []) as { id: string; fecha_inicio: string | null; fecha_fin: string | null }[]

  let shouldBeComplete = false
  if (items.length > 0) {
    if (requireAllDates) {
      shouldBeComplete = items.every(i => i.fecha_inicio && i.fecha_fin)
    } else {
      shouldBeComplete = true // al menos 1 item existe
    }
  }

  // Leer estado actual del bloque
  const { data: bloque } = await db(supabase)
    .from('negocio_bloques')
    .select('estado')
    .eq('id', negocioBloqueId)
    .single()

  const estadoActual = (bloque as { estado: string } | null)?.estado

  if (shouldBeComplete && estadoActual !== 'completo') {
    await db(supabase)
      .from('negocio_bloques')
      .update({ estado: 'completo', completado_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', negocioBloqueId)
  } else if (!shouldBeComplete && estadoActual === 'completo') {
    await db(supabase)
      .from('negocio_bloques')
      .update({ estado: 'pendiente', completado_at: null, updated_at: new Date().toISOString() })
      .eq('id', negocioBloqueId)
  }

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
    revisado: true,
    revisado_at: new Date().toISOString(),
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

      await reevaluarBloquesCobros(negocioId)
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

  await reevaluarBloquesCobros(negocioId)
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

  const { data: bloqueInfo } = await db(supabase)
    .from('negocio_bloques')
    .select('negocio_id')
    .eq('id', negocioBloqueId)
    .single()

  const negocioId = (bloqueInfo as { negocio_id: string } | null)?.negocio_id

  if (staffId && workspaceId && negocioId) {
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

  if (negocioId) revalidatePath(`/negocios/${negocioId}`)

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
  datosOtrasEtapas: Record<number, Record<string, unknown>>
  bloquesEtapasPrevias: Array<{
    etapa_orden: number
    etapa_nombre: string
    block_id: string | null
    id: string
    etapa_id: string
    workspace_id: string
    bloque_definition_id: string
    estado: string
    orden: number
    es_gate: boolean
    nombre: string | null
    bloque_definitions: {
      id: string
      tipo: string
      nombre: string
      is_visualization: boolean
      can_be_gate: boolean
    } | null
    instancia: {
      id: string
      negocio_id: string
      bloque_config_id: string
      estado: string
      data: Record<string, unknown> | null
    } | null
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
  profiles: Array<{ id: string; full_name: string | null; email: string | null }>
  currentUserId: string | null
  userRole: string
  cobros: Array<{
    id: string
    concepto: string | null
    monto: number
    revisado: boolean
    tipo_cobro: string | null
    fecha: string | null
    fecha_esperada: string | null
    numero_cuota: number | null
    vencido: boolean
    notas: string | null
    external_ref: string | null
  }>
  cotizacion: null
  cotizacionesNegocio: CotizacionResumen[]
  resumenFinanciero: {
    totalCobrado: number
    porCobrar: number
    costosEjecutados: number
    precioAprobado?: number
  }
  ejecucionData: {
    totalGastos: number
    totalHoras: number
    costoHoras: number
    gastosPorCategoria: Array<{ categoria: string; total: number }>
    presupuestoPorRubro?: Array<{ tipo: string; nombre: string; total: number }>
    precioAprobado?: number
  }
  historialData: {
    gastos: Array<{ id: string; descripcion: string | null; monto: number; categoria: string; fecha: string }>
    horas: Array<{ id: string; descripcion: string | null; horas: number; fecha: string; staff_nombre: string | null }>
    cobros: Array<{ id: string; notas: string | null; monto: number; fecha: string | null; revisado: boolean; tipo_cobro: string | null }>
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
  pausaEnabled: boolean
} | null> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return null

  // Cargar negocio base
  const base = await getNegocioDetalle(id)
  if (!base) return null

  // Feature flag pausa_enabled
  const { data: wsRow } = await db(supabase)
    .from('workspaces')
    .select('modules')
    .eq('id', workspaceId)
    .single()
  const wsModules = (wsRow as { modules: Record<string, unknown> | null } | null)?.modules ?? {}
  const pausaEnabled = wsModules.pausa_enabled === true

  // Cargar config_extra de los bloque_configs
  const bloqueConfigIds = base.bloques.map(b => b.id)
  const bloqueConfigsExtra: Record<string, Record<string, unknown>> = {}
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
  const itemsByBloqueId: Record<string, unknown[]> = {}
  if (negocioBloqueIds.length > 0) {
    const { data: itemsData } = await db(supabase)
      .from('bloque_items')
      .select('id, negocio_bloque_id, label, tipo, completado, completado_por, completado_at, link_url, imagen_data, orden, fecha_inicio, fecha_fin, responsable_id')
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
      .select('id, full_name, salary')
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
    .select('id, notas, monto, revisado, tipo_cobro, fecha, fecha_esperada, numero_cuota, vencido, external_ref')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', id)
    .order('created_at', { ascending: true })

  // Cargar gastos del negocio para costosEjecutados + historial
  //
  // Honra centro_costos (decisión Santiago + centro-costos sprint 2026-05-30):
  //   - Gastos con centro_costos='directa_negocio' AND negocio_id=id → SI
  //   - Gastos legacy (centro_costos IS NULL) con negocio_id=id → SI (compat)
  //   - Gastos centro_costos='mixta' con split parcial a este negocio → SI con prorrateo
  //   - Gastos con centro_costos='distribuible_one' o 'distribuible_clarity' → NO
  //
  // Implementación: 2 queries y merge en memoria. Más simple que un OR complejo
  // en PostgREST sobre jsonb.

  const [gastosDirectosRes, gastosMixtaRes] = await Promise.all([
    db(supabase)
      .from('gastos')
      .select('id, descripcion, monto, categoria, fecha, centro_costos, split_json')
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', id)
      // Filtrar: directa_negocio o legacy (centro_costos null)
      .or('centro_costos.eq.directa_negocio,centro_costos.is.null')
      .order('fecha', { ascending: false }),
    db(supabase)
      .from('gastos')
      .select('id, descripcion, monto, categoria, fecha, centro_costos, split_json')
      .eq('workspace_id', workspaceId)
      .eq('centro_costos', 'mixta')
      .not('split_json', 'is', null),
  ])

  // Filtrar mixta que tengan split a este negocio específico
  const splitKey = `negocio:${id}`
  type GastoRow = {
    id: string
    descripcion: string | null
    monto: number
    categoria: string
    fecha: string
    centro_costos: string | null
    split_json: Record<string, number> | null
  }

  const gastosMixtaParcial = ((gastosMixtaRes.data ?? []) as GastoRow[])
    .filter((g) => {
      if (!g.split_json) return false
      const pct = Number(g.split_json[splitKey] ?? 0)
      return pct > 0
    })
    .map((g) => {
      const pct = Number(g.split_json?.[splitKey] ?? 0)
      return {
        ...g,
        // Prorratear monto al porcentaje del split que toca a este negocio
        monto: Math.round((g.monto ?? 0) * pct),
        // Marcar la descripción con el badge de % para que la UI lo distinga
        descripcion: g.descripcion
          ? `${g.descripcion} (${Math.round(pct * 100)}% del gasto)`
          : `Gasto mixto (${Math.round(pct * 100)}% del gasto)`,
      }
    })

  // Merge: gastos directos + mixta prorrateados, orden descendente por fecha
  const gastosData = [
    ...((gastosDirectosRes.data ?? []) as GastoRow[]),
    ...gastosMixtaParcial,
  ].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''))

  // Cargar horas del negocio

  const { data: horasData } = await db(supabase)
    .from('horas')
    .select('id, horas, descripcion, fecha, staff_id')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', id)
    .order('fecha', { ascending: false })

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

  // Buscar cotización aceptada y sus rubros para presupuesto
  const cotizacionAceptada = cotizacionesNegocio.find(c => c.estado === 'aceptada')
  let presupuestoPorRubro: { tipo: string; nombre: string; total: number }[] = []
  let precioAprobado: number | undefined = undefined

  if (cotizacionAceptada) {
    precioAprobado = cotizacionAceptada.valor_total ?? undefined
    // Cargar items con rubros de la cotizacion aceptada
    const { data: itemsConRubros } = await supabase
      .from('items')
      .select('nombre, subtotal, rubros(tipo, valor_total)')
      .eq('cotizacion_id', cotizacionAceptada.id)
      .order('orden')

    if (itemsConRubros && itemsConRubros.length > 0) {
      // Agrupar rubros por tipo y sumar valores
      const rubroMap: Record<string, { nombre: string; total: number }> = {}
      for (const item of itemsConRubros) {
        const rubros = (item.rubros ?? []) as Array<{ tipo: string; valor_total: number | null }>
        if (rubros.length > 0) {
          for (const r of rubros) {
            const tipo = r.tipo ?? 'otro'
            if (!rubroMap[tipo]) rubroMap[tipo] = { nombre: tipo, total: 0 }
            rubroMap[tipo].total += r.valor_total ?? 0
          }
        } else {
          // Item sin rubros detallados: usar subtotal como "otro"
          const tipo = 'otro'
          if (!rubroMap[tipo]) rubroMap[tipo] = { nombre: tipo, total: 0 }
          rubroMap[tipo].total += item.subtotal ?? 0
        }
      }
      presupuestoPorRubro = Object.entries(rubroMap)
        .map(([tipo, data]) => ({ tipo, nombre: data.nombre, total: data.total }))
        .filter(r => r.total > 0)
        .sort((a, b) => b.total - a.total)
    } else if (cotizacionAceptada.valor_total && cotizacionAceptada.valor_total > 0) {
      // Cotización rápida sin items: un solo rubro genérico
      presupuestoPorRubro = [{ tipo: 'total', nombre: 'Total cotizado', total: cotizacionAceptada.valor_total }]
    }
  }

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
    revisado: boolean
  }>
  // 2026-04-28: cobros registrados = dinero entrado. revisado es flag para
  // contador (bandeja /revision), no afecta cálculos operativos.
  const totalCobrado = cobrosList.reduce((sum, c) => sum + (c.monto ?? 0), 0)

  // ── Cross-etapa data for conditions + auto_fill ────────────────────────────
  const sourceEtapaOrdens = new Set<number>()
  for (const bcId of Object.keys(bloqueConfigsExtra)) {
    const ce = bloqueConfigsExtra[bcId]
    const cond = ce?.condition as { source_etapa_orden?: number } | undefined
    if (cond?.source_etapa_orden) sourceEtapaOrdens.add(cond.source_etapa_orden)
    const fields = (ce?.fields ?? []) as Array<{ auto_fill?: { source_etapa_orden?: number } }>
    for (const f of fields) {
      if (f.auto_fill?.source_etapa_orden) sourceEtapaOrdens.add(f.auto_fill.source_etapa_orden)
    }
  }

  // Si hay un bloque tipo guia_devolucion en la etapa actual, su preview depende
  // de RUT, Factura y Fecha cita DIAN. Se resuelven por IDENTIDAD DE BLOQUE
  // (nombre), no por orden de etapa — robusto a reordenamientos. Mapa nombre→data
  // (campos AI aplanados), ignorando heredados readonly (sin campos propios).
  const tieneGuia = base.bloques.some(b =>
    (b as { bloque_definitions?: { tipo?: string } | null }).bloque_definitions?.tipo === 'guia_devolucion'
  )
  const datosGuiaPorNombre: Record<string, Record<string, unknown>> = {}
  if (tieneGuia) {
    const { data: bloquesGuia } = await db(supabase)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(nombre, config_extra)')
      .eq('negocio_id', id)
    for (const b of ((bloquesGuia ?? []) as Record<string, unknown>[])) {
      const cfg = b.bloque_configs as { nombre?: string; config_extra?: Record<string, unknown> | null }
      if ((cfg?.config_extra as { source_etapa_orden?: unknown } | null)?.source_etapa_orden !== undefined) continue
      const nombre = (cfg?.nombre ?? '').toLowerCase().trim()
      if (!nombre) continue
      const data = (b.data ?? {}) as Record<string, unknown>
      const flat: Record<string, unknown> = { ...data }
      const campos = data.campos as Record<string, { value?: unknown }> | undefined
      if (campos) {
        for (const [slug, c] of Object.entries(campos)) {
          if (c?.value !== null && c?.value !== undefined) flat[slug] = c.value
        }
      }
      datosGuiaPorNombre[nombre] = flat
    }
  }

  // Tambien recolectar source_etapa_orden de bloques de etapas previas: cuando
  // el negocio avanza de etapa, el historial necesita resolver auto_fill de
  // bloques de etapas previas (ej. DA6/DA7 en E6 con auto_fill desde E2/E5).
  // Sin esto, datosOtrasEtapas queda vacio para los rangos que el historial
  // necesita y los bloques readonly quedan filtrados del historial.
  if (base.negocio.linea_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: allConfigs } = await (db(supabase) as any)
      .from('bloque_configs')
      .select('config_extra, etapas_negocio!inner(linea_id, orden)')
      .eq('etapas_negocio.linea_id', base.negocio.linea_id)
    for (const c of ((allConfigs ?? []) as Record<string, unknown>[])) {
      const ce = c.config_extra as { fields?: Array<{ auto_fill?: { source_etapa_orden?: number } }> } | null
      const fields = ce?.fields ?? []
      for (const f of fields) {
        if (f.auto_fill?.source_etapa_orden !== undefined) {
          sourceEtapaOrdens.add(f.auto_fill.source_etapa_orden)
        }
      }
    }
  }

  const datosOtrasEtapas: Record<number, Record<string, unknown>> = {}
  if (sourceEtapaOrdens.size > 0 && base.negocio.linea_id) {
    const { data: etapasSource } = await db(supabase)
      .from('etapas_negocio')
      .select('id, orden')
      .eq('linea_id', base.negocio.linea_id)
      .in('orden', [...sourceEtapaOrdens])
    if (etapasSource) {
      const etapaIdToOrden = new Map<string, number>()
      const etapaIds = (etapasSource as Array<{ id: string; orden: number }>).map(e => {
        etapaIdToOrden.set(e.id, e.orden)
        return e.id
      })
      const { data: bloquesOtras } = await db(supabase)
        .from('negocio_bloques')
        .select('data, bloque_configs!inner(etapa_id, bloque_definitions!inner(tipo))')
        .eq('negocio_id', id)
        .in('bloque_configs.etapa_id', etapaIds)
      for (const b of ((bloquesOtras ?? []) as Record<string, unknown>[])) {
        const config = b.bloque_configs as Record<string, unknown>
        const etapaId = config.etapa_id as string
        const orden = etapaIdToOrden.get(etapaId)
        if (orden === undefined) continue
        if (!datosOtrasEtapas[orden]) datosOtrasEtapas[orden] = {}
        const data = b.data as Record<string, unknown> | null
        if (data) {
          Object.assign(datosOtrasEtapas[orden], data)
          // Flatten AI-extracted campos into top-level for condition/auto_fill lookup
          const campos = data.campos as Record<string, { value: string | null }> | undefined
          if (campos) {
            for (const [slug, campo] of Object.entries(campos)) {
              if (campo?.value !== null && campo?.value !== undefined) {
                datosOtrasEtapas[orden][slug] = campo.value
              }
            }
          }
        }
      }
    }
  }

  // ── Cargar data de bloques propuesta_economica del negocio (para herencia readonly)
  // Indexado por etapa_orden — usado mas abajo para que bloques readonly heredados
  // en etapas posteriores muestren el data (versiones, descuento, valor) del bloque
  // origen.
  const propuestaDataPorEtapa: Record<number, Record<string, unknown>> = {}
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: propuestaBlocks } = await (db(supabase) as any)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(etapa_id, bloque_definitions!inner(tipo), etapas_negocio!inner(orden))')
      .eq('negocio_id', id)
      .eq('bloque_configs.bloque_definitions.tipo', 'propuesta_economica')
    if (propuestaBlocks) {
      for (const pb of (propuestaBlocks as Record<string, unknown>[])) {
        const cfg = pb.bloque_configs as Record<string, unknown>
        const etapa = cfg.etapas_negocio as { orden: number } | undefined
        if (etapa && pb.data) {
          propuestaDataPorEtapa[etapa.orden] = pb.data as Record<string, unknown>
        }
      }
    }
  }

  // ── Cargar data de bloques documento del negocio (para herencia readonly)
  // Indexado por (etapa_orden + nombre normalizado) porque hay multiples documentos
  // por etapa (Factura, RUT, Cedula, Comprobante, etc.) y el matching para herencia
  // se hace por (etapa source, nombre, tipo) en otros sitios. Cuando un bloque tipo
  // 'documento' tiene source_etapa_orden en su config_extra, leemos drive_url +
  // file_name + campos extraidos del bloque origen.
  const documentoDataPorEtapaNombre = new Map<string, Record<string, unknown>>()
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: docBlocks } = await (db(supabase) as any)
      .from('negocio_bloques')
      .select('data, bloque_configs!inner(nombre, etapa_id, bloque_definitions!inner(tipo, nombre), etapas_negocio!inner(orden))')
      .eq('negocio_id', id)
      .eq('bloque_configs.bloque_definitions.tipo', 'documento')
    if (docBlocks) {
      for (const db_ of (docBlocks as Record<string, unknown>[])) {
        const cfg = db_.bloque_configs as Record<string, unknown>
        const etapa = cfg.etapas_negocio as { orden: number } | undefined
        if (!etapa || !db_.data) continue
        const defNombre = (cfg.bloque_definitions as { nombre?: string } | undefined)?.nombre ?? ''
        const cfgNombre = (cfg.nombre as string | null) ?? defNombre
        const key = `${etapa.orden}::${cfgNombre.trim().toLowerCase()}`
        documentoDataPorEtapaNombre.set(key, db_.data as Record<string, unknown>)
      }
    }
  }

  // ── Historial: bloques con data de etapas previas (con orden < etapa actual)
  // Estructura completa para que el cliente los renderice con BloqueRenderer
  // en modo 'visible' (read-only nativo de cada tipo).
  type BloqueHistorialFull = {
    // BloqueConfig fields
    id: string
    etapa_id: string
    workspace_id: string
    bloque_definition_id: string
    estado: string
    orden: number
    es_gate: boolean
    nombre: string | null
    bloque_definitions: {
      id: string
      tipo: string
      nombre: string
      is_visualization: boolean
      can_be_gate: boolean
    } | null
    // Custom enrichments
    instancia: {
      id: string
      negocio_id: string
      bloque_config_id: string
      estado: string
      data: Record<string, unknown> | null
    } | null
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
  }
  type BloqueHistorialPlano = BloqueHistorialFull & {
    etapa_orden: number
    etapa_nombre: string
    block_id: string | null
  }
  const bloquesEtapasPrevias: BloqueHistorialPlano[] = []
  {
    const etapaActualOrden = base.etapasLinea.find(
      e => e.id === base.negocio.etapa_actual_id,
    )?.orden ?? 0
    const etapasPrevias = base.etapasLinea
      .filter(e => e.orden < etapaActualOrden)
      .sort((a, b) => a.orden - b.orden) // orden de aparicion en el flujo
    if (etapasPrevias.length > 0) {
      const etapaIdsPrevias = etapasPrevias.map(e => e.id)
      // Cargar bloque_configs + bloque_definitions de etapas previas
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: prevConfigs } = await (db(supabase) as any)
        .from('bloque_configs')
        .select(`
          id, etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre,
          bloque_definitions(id, tipo, nombre, is_visualization, can_be_gate)
        `)
        .in('etapa_id', etapaIdsPrevias)
        .eq('workspace_id', workspaceId)
        .order('orden', { ascending: true })
      // Cargar instancias del negocio para esos bloque_configs
      const configIds = (prevConfigs as Record<string, unknown>[] | null)?.map(c => c.id as string) ?? []
      const instanciasMap = new Map<string, {
        id: string; negocio_id: string; bloque_config_id: string; estado: string; data: Record<string, unknown> | null
      }>()
      if (configIds.length > 0) {
        const { data: prevInsts } = await db(supabase)
          .from('negocio_bloques')
          .select('id, negocio_id, bloque_config_id, estado, data')
          .eq('negocio_id', id)
          .in('bloque_config_id', configIds)
        for (const inst of ((prevInsts ?? []) as Record<string, unknown>[])) {
          instanciasMap.set(inst.bloque_config_id as string, {
            id: inst.id as string,
            negocio_id: inst.negocio_id as string,
            bloque_config_id: inst.bloque_config_id as string,
            estado: (inst.estado as string) ?? 'pendiente',
            data: inst.data as Record<string, unknown> | null,
          })
        }
      }
      // Cargar config_extra desde bloqueConfigsExtra ya construido arriba o consultar
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: prevConfigsExtra } = await (db(supabase) as any)
        .from('bloque_configs')
        .select('id, config_extra')
        .in('id', configIds.length > 0 ? configIds : ['00000000-0000-0000-0000-000000000000'])
      const ceMap = new Map<string, Record<string, unknown>>()
      for (const row of ((prevConfigsExtra ?? []) as Record<string, unknown>[])) {
        ceMap.set(row.id as string, (row.config_extra as Record<string, unknown>) ?? {})
      }
      // Cargar bloque_items (cronograma, checklist, etc.)
      const instIds = Array.from(instanciasMap.values()).map(i => i.id)
      const itemsByInst = new Map<string, Array<{
        id: string; label: string; tipo: string; completado: boolean
        completado_por: string | null; completado_at: string | null
        link_url: string | null; imagen_data: string | null; orden: number
      }>>()
      if (instIds.length > 0) {
        const { data: prevItems } = await db(supabase)
          .from('bloque_items')
          .select('id, bloque_instancia_id, label, tipo, completado, completado_por, completado_at, link_url, imagen_data, orden')
          .in('bloque_instancia_id', instIds)
          .order('orden', { ascending: true })
        for (const it of ((prevItems ?? []) as Record<string, unknown>[])) {
          const bid = it.bloque_instancia_id as string
          if (!itemsByInst.has(bid)) itemsByInst.set(bid, [])
          itemsByInst.get(bid)!.push({
            id: it.id as string,
            label: it.label as string,
            tipo: it.tipo as string,
            completado: (it.completado as boolean) ?? false,
            completado_por: (it.completado_por as string | null) ?? null,
            completado_at: (it.completado_at as string | null) ?? null,
            link_url: (it.link_url as string | null) ?? null,
            imagen_data: (it.imagen_data as string | null) ?? null,
            orden: (it.orden as number) ?? 0,
          })
        }
      }
      // Ensamblar bloques planos: una fila por bloque-origen, sin duplicar
      // los readonly heredados (cualquier config con source_etapa_orden) ni
      // los tipos de visualizacion agregada (resumen_financiero, ejecucion,
      // historial). El componente HistorialEtapasPrevias los muestra en
      // orden de aparicion (etapa_orden ASC, bloque.orden ASC).
      const etapaInfoById = new Map(etapasPrevias.map(e => [e.id, { orden: e.orden, nombre: e.nombre }]))
      const HIDDEN_TYPES = new Set(['resumen_financiero', 'ejecucion', 'historial', 'historial_valida'])
      for (const cfg of ((prevConfigs ?? []) as Record<string, unknown>[])) {
        const inst = instanciasMap.get(cfg.id as string) ?? null
        if (!inst) continue
        const ce = ceMap.get(cfg.id as string) ?? {}
        // Filtrar readonly heredados: la version origen ya esta en la lista
        if (typeof (ce as { source_etapa_orden?: unknown }).source_etapa_orden === 'number') continue
        const def = cfg.bloque_definitions as BloqueHistorialFull['bloque_definitions']
        if (def && HIDDEN_TYPES.has(def.tipo)) continue
        const etapaInfo = etapaInfoById.get(cfg.etapa_id as string)
        if (!etapaInfo) continue

        // Calcular auto_fill resuelto contra datosOtrasEtapas (para bloques tipo
        // datos con campos derivados de etapas anteriores que nunca persisten
        // data propia — ej. DA6/DA7 en SOENA, readonly desde el config).
        const ceFields = (ce as { fields?: Array<{
          slug: string
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          auto_fill?: { field: string; source: string; mapping?: Record<string, any>; source_etapa_orden: number }
        }> }).fields ?? []
        const autoFillHist: Record<string, unknown> = {}
        for (const f of ceFields) {
          if (!f.auto_fill) continue
          const srcData = datosOtrasEtapas[f.auto_fill.source_etapa_orden]
          if (!srcData) continue
          const rawVal = srcData[f.auto_fill.field]
          if (f.auto_fill.mapping) {
            const srcVal = String(rawVal ?? '').toLowerCase().trim()
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            if (srcVal && f.auto_fill.mapping[srcVal] !== undefined) {
              autoFillHist[f.slug] = f.auto_fill.mapping[srcVal]
            }
          } else if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
            autoFillHist[f.slug] = rawVal
          }
        }

        // Excluir solo si todo esta vacio: sin data persistida, sin auto_fill
        // resuelto, y la instancia esta pendiente.
        const dataEmpty = !inst.data || Object.keys(inst.data).length === 0
        const autoFillEmpty = Object.keys(autoFillHist).length === 0
        if (dataEmpty && autoFillEmpty && inst.estado === 'pendiente') continue

        const ceEnriched = autoFillEmpty ? ce : { ...ce, _auto_fill: autoFillHist }

        bloquesEtapasPrevias.push({
          etapa_orden: etapaInfo.orden,
          etapa_nombre: etapaInfo.nombre,
          block_id: base.blockIdByConfigId[cfg.id as string] ?? null,
          id: cfg.id as string,
          etapa_id: cfg.etapa_id as string,
          workspace_id: cfg.workspace_id as string,
          bloque_definition_id: cfg.bloque_definition_id as string,
          estado: (cfg.estado as string) ?? 'editable',
          orden: (cfg.orden as number) ?? 0,
          es_gate: (cfg.es_gate as boolean) ?? false,
          nombre: (cfg.nombre as string | null) ?? null,
          bloque_definitions: def,
          instancia: inst,
          config_extra: ceEnriched,
          items: itemsByInst.get(inst.id) ?? [],
        })
      }
      bloquesEtapasPrevias.sort((a, b) =>
        a.etapa_orden !== b.etapa_orden ? a.etapa_orden - b.etapa_orden : a.orden - b.orden,
      )
    }
  }

  // ── Build enriched bloques with auto_fill values ──────────────────────────
  const bloquesConExtra = base.bloques.map(b => {
    const configExtra = bloqueConfigsExtra[b.id] ?? {}

    // Herencia readonly de propuesta_economica: si este bloque es readonly y
    // tiene source_etapa_orden, reemplazar data por la del bloque source (E1)
    // para que el componente renderice el historial de versiones completo.
    const tipoBloque = (b as { _tipo?: string })._tipo
      ?? (bloqueConfigsExtra[b.id] as { _tipo?: string } | undefined)?._tipo
    const isReadonlyPropuesta =
      configExtra.readonly === true
      && typeof configExtra.source_etapa_orden === 'number'
    if (isReadonlyPropuesta && b.instancia) {
      const srcData = propuestaDataPorEtapa[configExtra.source_etapa_orden as number]
      if (srcData) {
        b = { ...b, instancia: { ...b.instancia, data: srcData } }
      }
    }

    // Herencia readonly de documento: si este bloque es de tipo documento y tiene
    // source_etapa_orden, leer la data del bloque origen (drive_url, file_name,
    // campos extraidos) para que el render readonly tenga acceso al archivo.
    const defTipo = (b as { bloque_definitions?: { tipo?: string } | null }).bloque_definitions?.tipo
    const srcOrden = configExtra.source_etapa_orden as number | undefined
    if (defTipo === 'documento' && typeof srcOrden === 'number' && b.instancia) {
      const bNombre = (b.nombre ?? (b as { bloque_definitions?: { nombre?: string } | null }).bloque_definitions?.nombre ?? '').trim().toLowerCase()
      const srcData = documentoDataPorEtapaNombre.get(`${srcOrden}::${bNombre}`)
      if (srcData) {
        b = { ...b, instancia: { ...b.instancia, data: srcData } }
      }
    }
    // Si el tipo no se infirio, usamos detector indirecto: si hay srcData
    // disponible Y el config_extra del bloque indica readonly+source, lo
    // tratamos como heredado de propuesta_economica (caso canonico SOENA).
    void tipoBloque

    // Compute auto_fill defaults for datos fields
    const autoFill: Record<string, unknown> = {}
    const fields = (configExtra.fields ?? []) as Array<{
      slug: string
      tipo?: string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      auto_fill?: { field: string; source: string; mapping?: Record<string, any>; source_etapa_orden: number }
      doc_link?: { source_bloque_nombre: string; source_etapa_orden: number }
    }>
    for (const f of fields) {
      if (f.auto_fill) {
        const srcData = datosOtrasEtapas[f.auto_fill.source_etapa_orden]
        if (srcData) {
          const rawVal = srcData[f.auto_fill.field]
          if (f.auto_fill.mapping) {
            const srcVal = String(rawVal ?? '').toLowerCase().trim()
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents: eléctrico → electrico
            if (srcVal && f.auto_fill.mapping[srcVal] !== undefined) {
              autoFill[f.slug] = f.auto_fill.mapping[srcVal]
            }
          } else if (rawVal !== undefined && rawVal !== null && rawVal !== '') {
            // Valor directo sin mapping: copiar tal cual
            autoFill[f.slug] = rawVal
          }
        }
      }
    }

    // Resolver doc_link: buscar el bloque documento origen en etapas previas y
    // exponer drive_url + file_name del archivo cargado.
    const fieldsConDocLink = fields.filter(f => f.tipo === 'doc_link' && f.doc_link)
    let resolvedFields: typeof fields | null = null
    if (fieldsConDocLink.length > 0) {
      resolvedFields = fields.map(f => {
        if (f.tipo !== 'doc_link' || !f.doc_link) return f
        const target = bloquesEtapasPrevias.find(bp =>
          bp.etapa_orden === f.doc_link!.source_etapa_orden
          && (bp.nombre ?? bp.bloque_definitions?.nombre ?? '').trim().toLowerCase()
             === f.doc_link!.source_bloque_nombre.trim().toLowerCase()
        )
        const data = (target?.instancia?.data ?? null) as Record<string, unknown> | null
        const drive_url = (data?.drive_url as string | null) ?? null
        const file_name = (data?.file_name as string | null) ?? null
        return {
          ...f,
          doc_link: { ...f.doc_link, _resolved: { drive_url, file_name } },
        }
      })
    }

    const enrichedConfigExtra: Record<string, unknown> = { ...configExtra }
    if (Object.keys(autoFill).length > 0) enrichedConfigExtra._auto_fill = autoFill
    if (resolvedFields) enrichedConfigExtra.fields = resolvedFields

    // Preview para BloqueGuiaDevolucion: resuelve nombre, NIT, ciudad, fecha cita
    // y seccional sugerida desde otros bloques del negocio.
    if (defTipo === 'guia_devolucion') {
      // Resuelto por nombre de bloque (datosGuiaPorNombre), no por orden de etapa.
      const rutData = datosGuiaPorNombre['rut'] ?? {}
      const facturaData = datosGuiaPorNombre['factura de venta'] ?? {}
      const razonSocial = (rutData.razon_social as string) ?? ''
      const nit = (rutData.nit as string) ?? ''
      const dv = (rutData.dv as string) ?? ''
      const tipoPersona = (rutData.tipo_persona as string) ?? ''
      const ciudadVenta = (facturaData.ciudad_venta as string) ?? ''
      const fechaCitaData = datosGuiaPorNombre['fecha cita dian'] ?? {}
      const fechaCita = (fechaCitaData.fecha_cita_dian as string) ?? null
      const seccional = mapCiudadASeccional(ciudadVenta, tipoPersona)
      enrichedConfigExtra._guia_preview = {
        nombre: razonSocial || null,
        nit: nit ? (dv ? `${nit}-${dv}` : nit) : null,
        ciudad_venta: ciudadVenta || null,
        fecha_cita: fechaCita,
        seccional_sugerida_slug: seccional?.slug ?? null,
      }
    }

    return {
      ...b,
      config_extra: enrichedConfigExtra,
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
    }
  })

  return {
    negocio: base.negocio,
    bloques: bloquesConExtra,
    etapasLinea: base.etapasLinea,
    datosOtrasEtapas,
    bloquesEtapasPrevias,
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
      revisado: (c.revisado as boolean | null) ?? false,
      tipo_cobro: c.tipo_cobro as string | null,
      fecha: c.fecha as string | null,
      fecha_esperada: c.fecha_esperada as string | null,
      numero_cuota: c.numero_cuota as number | null,
      vencido: (c.vencido as boolean | null) ?? false,
      notas: c.notas as string | null,
      external_ref: c.external_ref as string | null,
    })),
    cotizacion,
    cotizacionesNegocio,
    resumenFinanciero: {
      totalCobrado,
      porCobrar: Math.max(0, (precioAprobado ?? 0) - totalCobrado),
      precioAprobado,
      costosEjecutados: (() => {
        const gastos = ((gastosData ?? []) as Array<{ monto: number }>)
        const totalGastos = gastos.reduce((s, g) => s + (g.monto ?? 0), 0)
        // Costo horas = horas * tarifa del staff (simplificado: usar salary/160)
        const staffData = (staffRes.data ?? []) as Array<{ id: string; salary?: number }>
        const staffSalaryMap: Record<string, number> = {}
        for (const s of staffData) staffSalaryMap[s.id] = (s as Record<string, unknown>).salary as number ?? 0
        const horas = ((horasData ?? []) as Array<{ horas: number; staff_id: string | null }>)
        const costoHoras = horas.reduce((s, h) => {
          const salary = h.staff_id ? (staffSalaryMap[h.staff_id] ?? 0) : 0
          const tarifa = salary > 0 ? salary / 160 : 0
          return s + ((h.horas ?? 0) * tarifa)
        }, 0)
        return Math.round(totalGastos + costoHoras)
      })(),
    },
    ejecucionData: (() => {
      const gastos = ((gastosData ?? []) as Array<{ monto: number; categoria: string; fecha: string }>)
      const totalGastos = gastos.reduce((s, g) => s + (g.monto ?? 0), 0)
      // Agrupar gastos por categoría
      const catMap: Record<string, number> = {}
      for (const g of gastos) {
        const cat = g.categoria ?? 'otros'
        catMap[cat] = (catMap[cat] ?? 0) + (g.monto ?? 0)
      }
      const gastosPorCategoria = Object.entries(catMap)
        .map(([categoria, total]) => ({ categoria, total }))
        .sort((a, b) => b.total - a.total)

      const staffDataArr = (staffRes.data ?? []) as Array<{ id: string; full_name: string; salary?: number }>
      const staffNameMap: Record<string, string> = {}
      const staffSalaryMap2: Record<string, number> = {}
      for (const s of staffDataArr) {
        staffNameMap[s.id] = s.full_name
        staffSalaryMap2[s.id] = (s as Record<string, unknown>).salary as number ?? 0
      }

      const horas = ((horasData ?? []) as Array<{ horas: number; descripcion: string | null; fecha: string; staff_id: string | null }>)
      const totalHoras = horas.reduce((s, h) => s + (h.horas ?? 0), 0)
      const costoHoras = horas.reduce((s, h) => {
        const salary = h.staff_id ? (staffSalaryMap2[h.staff_id] ?? 0) : 0
        const tarifa = salary > 0 ? salary / 160 : 0
        return s + ((h.horas ?? 0) * tarifa)
      }, 0)

      return {
        totalGastos,
        totalHoras: Math.round(totalHoras * 100) / 100,
        costoHoras: Math.round(costoHoras),
        gastosPorCategoria,
        presupuestoPorRubro: presupuestoPorRubro.length > 0 ? presupuestoPorRubro : undefined,
        precioAprobado,
      }
    })(),
    historialData: {
      gastos: ((gastosData ?? []) as Array<{ id: string; descripcion: string | null; monto: number; categoria: string; fecha: string }>).map(g => ({
        id: g.id,
        descripcion: g.descripcion ?? null,
        monto: g.monto ?? 0,
        categoria: g.categoria ?? 'otros',
        fecha: g.fecha ?? '',
      })),
      horas: ((horasData ?? []) as Array<{ id: string; horas: number; descripcion: string | null; fecha: string; staff_id: string | null }>).map(h => ({
        id: h.id,
        descripcion: h.descripcion,
        horas: h.horas ?? 0,
        fecha: h.fecha ?? '',
        staff_nombre: h.staff_id ? (staffMap[h.staff_id] ?? null) : null,
      })),
      cobros: ((cobrosData ?? []) as Record<string, unknown>[]).map(c => ({
        id: c.id as string,
        notas: c.notas as string | null,
        monto: c.monto as number,
        fecha: c.fecha as string | null,
        revisado: (c.revisado as boolean | null) ?? false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tipo_cobro: (c as any).tipo_cobro as string | null,
      })),
    },
    actividad,
    staffList: ((staffRes.data ?? []) as { id: string; full_name: string }[]).map(s => ({
      id: s.id,
      full_name: s.full_name,
    })),
    pausaEnabled,
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
  if (negocio.estado !== 'abierto') {
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

// ── Pausar negocio (stage venta) ──────────────────────────────────────────────

/**
 * Pausa un negocio que el cliente no ha avanzado. Oculto del pipeline activo.
 * Validaciones:
 * - Feature flag workspaces.modules.pausa_enabled = true
 * - Solo stage venta, estado abierto
 * - Motivo en lista cerrada (si otro → detalle requerido)
 * - Existe actividad en ultimos 30d (fuerza contacto real antes de pausar)
 * - fechaReapertura <= ultima_actividad + MAX_DIAS_PAUSA
 * - Al cuarto intento de pausa → auto-perdido con no_conversion_post_pausa
 */
export async function pausarNegocio(
  negocioId: string,
  motivo: string,
  fechaReapertura: string, // YYYY-MM-DD
  detalle?: string,
): Promise<{ error: string | null; autoPerdido?: boolean }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Validar feature flag
  const { data: wsRaw } = await db(supabase)
    .from('workspaces')
    .select('modules')
    .eq('id', workspaceId)
    .single()
  const modules = (wsRaw as { modules: Record<string, unknown> } | null)?.modules ?? {}
  if (modules.pausa_enabled !== true) {
    return { error: 'Funcionalidad de pausa no habilitada en este workspace' }
  }

  // Validar motivo
  const motivosValidos = MOTIVOS_PAUSA.map(m => m.value) as readonly string[]
  if (!motivosValidos.includes(motivo)) {
    return { error: 'Motivo de pausa no valido' }
  }
  if (motivo === 'otro' && !detalle?.trim()) {
    return { error: 'El detalle es obligatorio cuando el motivo es "otro"' }
  }

  // Cargar negocio
  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, stage_actual, estado, pausado, veces_pausado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!negocio) return { error: 'Negocio no encontrado' }

  type N = { stage_actual: string; estado: string; pausado: boolean; veces_pausado: number }
  const n = negocio as N
  if (n.estado !== 'abierto') return { error: 'El negocio ya esta cerrado' }
  if (n.stage_actual !== 'venta') return { error: 'Solo se puede pausar un negocio en etapa de venta' }
  if (n.pausado) return { error: 'El negocio ya esta pausado' }

  // Si ya alcanzo el maximo de pausas → auto-perdido
  if (n.veces_pausado >= MAX_PAUSAS) {
    const { error: updErr } = await db(supabase)
      .from('negocios')
      .update({
        estado: 'perdido',
        razon_cierre: 'no_conversion_post_pausa',
        descripcion_cierre: `Maximo de ${MAX_PAUSAS} pausas alcanzado sin conversion`,
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
        contenido: `Negocio auto-perdido: ${MAX_PAUSAS} pausas sin conversion`,
        valor_nuevo: 'perdido',
      })
    }
    revalidatePath(`/negocios/${negocioId}`)
    revalidatePath('/negocios')
    return { error: null, autoPerdido: true }
  }

  // Validar actividad reciente (ultimos 30d) — fuerza contacto real antes de pausar
  const desdeFecha = new Date()
  desdeFecha.setDate(desdeFecha.getDate() - 30)
  const { data: actividades } = await supabase
    .from('activity_log')
    .select('created_at')
    .eq('workspace_id', workspaceId)
    .eq('entidad_tipo', 'negocio')
    .eq('entidad_id', negocioId)
    .gte('created_at', desdeFecha.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)

  const ultimaActividad = ((actividades ?? []) as Array<{ created_at: string }>)[0]?.created_at
  if (!ultimaActividad) {
    return { error: 'Debe registrar al menos una interaccion con el cliente antes de pausar' }
  }

  // Validar fecha de reapertura <= ultima_actividad + MAX_DIAS_PAUSA
  const fechaLimite = new Date(ultimaActividad)
  fechaLimite.setDate(fechaLimite.getDate() + MAX_DIAS_PAUSA)
  const fechaReaperturaDate = new Date(`${fechaReapertura}T00:00:00`)
  if (isNaN(fechaReaperturaDate.getTime())) return { error: 'Fecha de reapertura invalida' }
  if (fechaReaperturaDate.getTime() > fechaLimite.getTime()) {
    return { error: `La fecha de reapertura no puede superar ${MAX_DIAS_PAUSA} dias desde la ultima actividad (${todayBogotaISO(fechaLimite)})` }
  }

  const now = new Date().toISOString()
  const { error: pauseErr } = await db(supabase)
    .from('negocios')
    .update({
      pausado: true,
      pausado_hasta: fechaReapertura,
      motivo_pausa: motivo,
      motivo_pausa_detalle: detalle?.trim() || null,
      veces_pausado: n.veces_pausado + 1,
      ultimo_pausado_at: now,
      updated_at: now,
    })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
  if (pauseErr) return { error: (pauseErr as { message: string }).message }

  const motivoLabel = MOTIVOS_PAUSA.find(m => m.value === motivo)?.label ?? motivo
  if (staffId) {
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_estado',
      autor_id: staffId,
      contenido: `Pausado hasta ${fechaReapertura}. Motivo: ${motivoLabel}${detalle ? ` — ${detalle}` : ''}`,
      valor_nuevo: `pausado:${motivo}`,
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null }
}

// ── Reactivar negocio (salir de pausa) ────────────────────────────────────────

/**
 * Reactiva un negocio pausado. Si la reactivacion ocurre dentro de las
 * SAFETY_NET_HORAS siguientes a la pausa, decrementa veces_pausado (evita
 * quemar una pausa por error del comercial).
 */
export async function reactivarNegocio(
  negocioId: string,
): Promise<{ error: string | null; safetyNet?: boolean }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, pausado, veces_pausado, ultimo_pausado_at, estado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()
  if (!negocio) return { error: 'Negocio no encontrado' }

  type N = { pausado: boolean; veces_pausado: number; ultimo_pausado_at: string | null; estado: string }
  const n = negocio as N
  if (n.estado !== 'abierto') return { error: 'El negocio ya esta cerrado' }
  if (!n.pausado) return { error: 'El negocio no esta pausado' }

  // Safety-net 24h: si pausa fue en las ultimas N horas → decrementar contador
  let decrementar = false
  if (n.ultimo_pausado_at) {
    const horasDesdePausa = (Date.now() - new Date(n.ultimo_pausado_at).getTime()) / 3600000
    if (horasDesdePausa <= SAFETY_NET_HORAS) decrementar = true
  }

  const now = new Date().toISOString()
  const { error: updErr } = await db(supabase)
    .from('negocios')
    .update({
      pausado: false,
      pausado_hasta: null,
      motivo_pausa: null,
      motivo_pausa_detalle: null,
      veces_pausado: decrementar ? Math.max(0, n.veces_pausado - 1) : n.veces_pausado,
      updated_at: now,
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
      contenido: decrementar ? 'Negocio reactivado (safety-net 24h: pausa no consumida)' : 'Negocio reactivado',
      valor_nuevo: 'activo',
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  revalidatePath('/negocios')
  return { error: null, safetyNet: decrementar }
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
  if (negocio.estado !== 'abierto') {
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
  if (negocio.stage_actual === 'venta') {
    return { error: 'Los negocios en etapa de venta se cierran con Perder, no con Completar' }
  }
  if (negocio.estado !== 'abierto') {
    return { error: 'El negocio ya esta cerrado' }
  }

  // Calcular snapshot financiero: buscar cobros del negocio
  const { data: cobrosData } = await db(supabase)
    .from('cobros')
    .select('monto, revisado')
    .eq('negocio_id', negocioId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cobros = ((cobrosData ?? []) as any[]) as Array<{ monto: number }>
  // 2026-04-28: todos los cobros registrados cuentan. revisado es para contador.
  const totalCobrado = cobros.reduce((sum, c) => sum + (c.monto ?? 0), 0)
  const precioAprobado = negocio.precio_aprobado ?? negocio.precio_estimado ?? 0
  const pendiente = Math.max(0, precioAprobado - totalCobrado)

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

// ── Actualizar responsable del negocio ────────────────────────────────────────

export async function actualizarResponsable(
  negocioId: string,
  responsableId: string | null
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  // Solo owner, admin, supervisor pueden asignar responsable
  const allowed = ['owner', 'admin', 'supervisor']
  if (!role || !allowed.includes(role)) {
    return { error: 'Sin permisos para asignar responsable' }
  }

  // Verificar que el negocio pertenece al workspace
  const { data: negocio } = await db(supabase)
    .from('negocios')
    .select('id, responsable_id')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!negocio) return { error: 'Negocio no encontrado' }

  // Obtener nombre del nuevo responsable para el log
  let nombreResponsable = 'Ninguno'
  if (responsableId) {
    const { data: staff } = await supabase
      .from('staff')
      .select('full_name')
      .eq('id', responsableId)
      .eq('workspace_id', workspaceId)
      .single()
    if (!staff) return { error: 'Staff no encontrado' }
    nombreResponsable = staff.full_name ?? 'Sin nombre'
  }

  const { error: updErr } = await db(supabase)
    .from('negocios')
    .update({ responsable_id: responsableId })
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)

  if (updErr) return { error: (updErr as { message: string }).message }

  // Registrar en activity_log
  if (staffId) {
    const descripcion = responsableId
      ? `Responsable cambiado a ${nombreResponsable}`
      : 'Responsable removido'
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'cambio_sistema',
      autor_id: staffId,
      contenido: descripcion,
    })
  }

  revalidatePath(`/negocios/${negocioId}`)
  return { error: null }
}

// Constantes de cierre movidas a src/lib/negocios/constants.ts para evitar
// error "use server file can only export async functions"
