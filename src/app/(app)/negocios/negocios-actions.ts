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
    .select('id, descripcion, etapa, valor_estimado, updated_at, empresas(nombre), contactos(nombre), codigo')
    .eq('workspace_id', workspaceId)
    .not('etapa', 'in', '(ganada,perdida)')
    .order('updated_at', { ascending: false })

  // Fetch proyectos (todos menos cancelados — estados reales: en_ejecucion, pausado, entregado, cerrado)
  const { data: proyectos } = await supabase
    .from('v_proyecto_financiero')
    .select('proyecto_id, nombre, estado, presupuesto_total, costo_acumulado, presupuesto_consumido_pct, empresa_nombre, contacto_nombre, updated_at, codigo')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })

  const propuestas: NegocioItem[] = (opps ?? []).map(o => {
    const empresa = (o.empresas as { nombre: string } | null)?.nombre
    const contacto = (o.contactos as { nombre: string } | null)?.nombre
    const codigoBase = o.codigo ?? ''
    return {
      id: o.id,
      tipo: 'oportunidad',
      codigo: codigoBase,
      codigoDisplay: codigoBase ? `${codigoBase}·C` : 'OPP·C',
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
    }
  })

  const enCurso: NegocioItem[] = []
  const porCobrar: NegocioItem[] = []
  const historial: NegocioItem[] = []

  for (const p of (proyectos ?? [])) {
    const estado = p.estado ?? 'cerrado'
    const stage = stageProyecto(estado)
    const item: NegocioItem = {
      id: p.proyecto_id ?? '',
      tipo: 'proyecto',
      codigo: p.codigo ? `P-${String(p.codigo).padStart(3, '0')}` : '',
      codigoDisplay: sufijoCodigo(p.codigo as number | null, estado),
      nombre: p.nombre ?? 'Sin nombre',
      cliente: (p.empresa_nombre ?? p.contacto_nombre) ?? 'Sin cliente',
      valor: p.presupuesto_total ?? 0,
      stage,
      etiquetaStage: etiquetaProyecto(estado),
      colorStage: colorProyecto(estado),
      presupuestoConsumidoPct: p.presupuesto_consumido_pct ?? null,
      presupuestoTotal: p.presupuesto_total ?? null,
      costoAcumulado: p.costo_acumulado ?? null,
      fechaActualizacion: p.updated_at ?? '',
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
    discovery_hecha: 'DISCOVERY',
    propuesta_enviada: 'EN PROPUESTA',
    negociacion: 'NEGOCIACION',
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

function sufijoCodigo(codigo: number | null, estado: string): string {
  const base = codigo ? `P-${String(codigo).padStart(3, '0')}` : 'P'
  if (['en_ejecucion', 'pausado'].includes(estado)) return `${base}·E`
  if (estado === 'entregado') return `${base}·R`
  if (estado === 'cerrado') return `${base}·X`
  return `${base}·E`
}
