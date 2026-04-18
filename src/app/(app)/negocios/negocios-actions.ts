'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'

export type NegocioStage = 'propuestas' | 'en-curso' | 'por-cobrar' | 'historial'

export type NegocioItem = {
  id: string
  tipo: 'oportunidad' | 'proyecto'
  codigo: string
  codigoDisplay: string
  nombre: string
  cliente: string
  valor: number
  stage: NegocioStage
  etiquetaStage: string
  colorStage: string
  presupuestoConsumidoPct: number | null
  presupuestoTotal: number | null
  costoAcumulado: number | null
  fechaActualizacion: string
  responsableNombre: string | null
  diasSinActividad: number
  diasEnStage: number
  carpetaUrl: string | null
  customData: Record<string, unknown> | null
}

// Estados operativos VE
const VE_ESTADO_LABELS: Record<string, string> = {
  por_inclusion: 'POR INCLUSION',
  por_radicar: 'POR RADICAR',
  por_certificar: 'POR CERTIFICAR',
  certificado: 'CERTIFICADO',
  por_cobrar: 'POR COBRAR',
  cerrado: 'CERRADO',
}

const VE_ESTADO_COLOR: Record<string, string> = {
  por_inclusion: 'indigo',
  por_radicar: 'amber',
  por_certificar: 'purple',
  certificado: 'green',
  por_cobrar: 'blue',
  cerrado: 'slate',
}

export async function getNegocios(): Promise<{
  propuestas: NegocioItem[]
  enCurso: NegocioItem[]
  porCobrar: NegocioItem[]
  historial: NegocioItem[]
  totales: {
    pipeline: number
    contratado: number
    porCobrar: number
  }
}> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) {
    return {
      propuestas: [],
      enCurso: [],
      porCobrar: [],
      historial: [],
      totales: { pipeline: 0, contratado: 0, porCobrar: 0 },
    }
  }

  // Fetch oportunidades activas (no ganadas ni perdidas)
  const { data: opps } = await supabase
    .from('oportunidades')
    .select('id, descripcion, etapa, valor_estimado, updated_at, etapa_changed_at, carpeta_url, empresas(nombre), contactos(nombre), codigo, responsable:staff!oportunidades_responsable_id_fkey(full_name)')
    .eq('workspace_id', workspaceId)
    .not('etapa', 'in', '(ganada,perdida)')
    .order('updated_at', { ascending: false })

  // Fetch proyectos (todos menos cancelados — estados reales: en_ejecucion, pausado, entregado, cerrado)
  // Hacemos join directo a proyectos para obtener custom_data (la vista no lo expone)
  const { data: proyectos } = await supabase
    .from('v_proyecto_financiero')
    .select('proyecto_id, nombre, estado, presupuesto_total, costo_acumulado, presupuesto_consumido_pct, empresa_nombre, contacto_nombre, codigo, oportunidad_id, oportunidad_codigo, responsable_nombre, ultima_actividad, updated_at, estado_changed_at, carpeta_url')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })

  // Obtener custom_data de proyectos VE (estado_ve)
  const proyectoIds = (proyectos ?? []).map(p => p.proyecto_id).filter(Boolean) as string[]
  const customDataMap: Record<string, Record<string, unknown>> = {}
  if (proyectoIds.length > 0) {
    const { data: proyectosExtra } = await supabase
      .from('proyectos')
      .select('id, custom_data')
      .in('id', proyectoIds)
    for (const p of (proyectosExtra ?? [])) {
      if (p.custom_data) customDataMap[p.id] = p.custom_data as Record<string, unknown>
    }
  }

  const propuestas: NegocioItem[] = (opps ?? []).map(o => {
    const empresa = (o.empresas as { nombre: string } | null)?.nombre
    const contacto = (o.contactos as { nombre: string } | null)?.nombre
    const codigoBase = o.codigo ?? ''
    const responsable = (o.responsable as { full_name: string } | null)?.full_name ?? null
    const diasSinActividad = calcDiasSinActividad(o.updated_at)
    return {
      id: o.id,
      tipo: 'oportunidad',
      codigo: codigoBase,
      codigoDisplay: codigoBase ? `${codigoBase}·C` : '·C',
      nombre: o.descripcion ?? 'Sin nombre',
      cliente: empresa ?? contacto ?? 'Sin cliente',
      valor: o.valor_estimado ?? 0,
      stage: 'propuestas',
      etiquetaStage: etiquetaOpp(o.etapa),
      colorStage: colorOpp(o.etapa),
      presupuestoConsumidoPct: null,
      presupuestoTotal: null,
      costoAcumulado: null,
      fechaActualizacion: o.updated_at ?? '',
      responsableNombre: responsable,
      diasSinActividad,
      diasEnStage: calcDiasSinActividad((o.etapa_changed_at ?? o.updated_at) as string | null),
      carpetaUrl: o.carpeta_url ?? null,
      customData: null,
    }
  })

  const enCurso: NegocioItem[] = []
  const porCobrar: NegocioItem[] = []
  const historial: NegocioItem[] = []

  for (const p of (proyectos ?? [])) {
    const estado = p.estado ?? 'cerrado'
    const cd = customDataMap[p.proyecto_id ?? ''] ?? null
    const estadoVe = cd?.estado_ve as string | undefined
    const stage = stageProyecto(estado)
    const codigoBase = (p.oportunidad_codigo ?? p.codigo ?? '') as string

    // Para proyectos VE, usar etiqueta y color del estado_ve
    const esVe = !!estadoVe
    const etiqueta = esVe ? (VE_ESTADO_LABELS[estadoVe] ?? estadoVe.toUpperCase()) : etiquetaProyecto(estado)
    const color = esVe ? (VE_ESTADO_COLOR[estadoVe] ?? 'slate') : colorProyecto(estado)

    const item: NegocioItem = {
      id: p.proyecto_id ?? '',
      tipo: 'proyecto',
      codigo: codigoBase,
      codigoDisplay: codigoBase ? `${codigoBase}·${sufijoCodigo(estado)}` : `·${sufijoCodigo(estado)}`,
      nombre: stripEmpresaPrefix(p.nombre ?? ''),
      cliente: (p.empresa_nombre ?? p.contacto_nombre) ?? 'Sin cliente',
      valor: p.presupuesto_total ?? 0,
      stage,
      etiquetaStage: etiqueta,
      colorStage: color,
      presupuestoConsumidoPct: p.presupuesto_consumido_pct ?? null,
      presupuestoTotal: p.presupuesto_total ?? null,
      costoAcumulado: p.costo_acumulado ?? null,
      fechaActualizacion: p.updated_at ?? '',
      responsableNombre: (p.responsable_nombre as string | null) ?? null,
      diasSinActividad: calcDiasSinActividad((p.ultima_actividad ?? p.updated_at) as string | null),
      diasEnStage: calcDiasSinActividad((p.estado_changed_at ?? p.updated_at) as string | null),
      carpetaUrl: (p.carpeta_url as string | null) ?? null,
      customData: cd,
    }
    if (stage === 'en-curso') enCurso.push(item)
    else if (stage === 'por-cobrar') porCobrar.push(item)
    else historial.push(item)
  }

  const pipeline = propuestas.reduce((s, o) => s + o.valor, 0)
  const contratado = enCurso.reduce((s, p) => s + p.valor, 0)
  const totalPorCobrar = porCobrar.reduce((s, p) => s + (p.presupuestoTotal ?? p.valor), 0)

  return {
    propuestas,
    enCurso,
    porCobrar,
    historial,
    totales: { pipeline, contratado, porCobrar: totalPorCobrar },
  }
}

// Estados reales: en_ejecucion, pausado, entregado, cerrado
function stageProyecto(estado: string): NegocioStage {
  if (['en_ejecucion', 'pausado'].includes(estado)) return 'en-curso'
  if (['entregado'].includes(estado)) return 'por-cobrar'
  // cerrado y cualquier otro van a historial
  return 'historial'
}

function etiquetaOpp(etapa: string | null): string {
  const map: Record<string, string> = {
    lead_nuevo: 'LEAD',
    contacto_inicial: 'CONTACTO',
    contactado: 'CONTACTADO',
    discovery_hecha: 'DISCOVERY',
    propuesta_enviada: 'EN PROPUESTA',
    negociacion: 'NEGOCIACION',
    pago_anticipo: 'ANTICIPO',
    recoleccion_docs: 'DOCUMENTOS',
    ganada: 'GANADA',
    perdida: 'PERDIDA',
  }
  return map[etapa ?? ''] ?? etapa?.toUpperCase() ?? 'ACTIVO'
}

function etiquetaProyecto(estado: string): string {
  const map: Record<string, string> = {
    en_ejecucion: 'EN CURSO',
    pausado: 'PAUSADO',
    entregado: 'ENTREGADO',
    cerrado: 'CERRADO',
  }
  return map[estado] ?? estado.toUpperCase()
}

function colorOpp(etapa: string | null): string {
  if (['propuesta_enviada', 'negociacion'].includes(etapa ?? '')) return 'amber'
  return 'slate'
}

function colorProyecto(estado: string): string {
  if (estado === 'en_ejecucion') return 'green'
  if (estado === 'pausado') return 'amber'
  if (estado === 'entregado') return 'blue'
  return 'slate'
}

function sufijoCodigo(estado: string): string {
  if (['en_ejecucion', 'pausado'].includes(estado)) return 'E'
  if (estado === 'entregado') return 'R'
  if (estado === 'cerrado') return 'X'
  return 'E'
}

function calcDiasSinActividad(fechaStr: string | null): number {
  if (!fechaStr) return 0
  const diff = Date.now() - new Date(fechaStr).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24))
}

// Proyectos se almacenan como "Empresa · Descripción" por el trigger.
// En la tarjeta solo mostramos la descripción (empresa ya aparece en cliente).
function stripEmpresaPrefix(nombre: string): string {
  if (!nombre) return 'Sin nombre'
  const idx = nombre.indexOf(' · ')
  return idx !== -1 ? nombre.slice(idx + 3) || nombre : nombre
}
