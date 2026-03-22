'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import type {
  ComercialData, OperativoData, FinancieroData,
  PipelineStage, TopOportunidad, RazonPerdida,
  ProyectoEstado, ProyectoRiesgo, GastoCategoria, StaffProductividad,
  MesIngresosEgresos, CategoriaGasto, ProyectoFacturacion,
  Periodo,
} from './types'

// ── Helpers ────────────────────────────────────────────────

const ETAPA_ORDER = ['lead', 'prospecto', 'propuesta', 'negociacion', 'ganado', 'perdido']
const ETAPA_LABELS: Record<string, string> = {
  lead: 'Lead', prospecto: 'Prospecto', propuesta: 'Propuesta',
  negociacion: 'Negociacion', ganado: 'Ganado', perdido: 'Perdido',
}
const ESTADO_LABELS: Record<string, string> = {
  en_ejecucion: 'En ejecucion', pausado: 'Pausado', completado: 'Completado',
  rework: 'Rework', cancelado: 'Cancelado', cerrado: 'Cerrado',
}
const CATEGORIA_LABELS: Record<string, string> = {
  materiales: 'Materiales', transporte: 'Transporte', servicios_profesionales: 'Servicios Prof.',
  viaticos: 'Viaticos', software: 'Software', impuestos_seguros: 'Impuestos/Seguros',
  mano_de_obra: 'Mano de obra', alimentacion: 'Alimentacion', otros: 'Otros',
}
const MES_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function getPeriodRange(periodo: Periodo): { start: string; end: string; meses: number } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() // 0-indexed
  const end = new Date(y, m + 1, 1).toISOString().split('T')[0]

  switch (periodo) {
    case 'mes': {
      const start = new Date(y, m, 1).toISOString().split('T')[0]
      return { start, end, meses: 1 }
    }
    case 'trimestre': {
      const start = new Date(y, m - 2, 1).toISOString().split('T')[0]
      return { start, end, meses: 3 }
    }
    case '6meses': {
      const start = new Date(y, m - 5, 1).toISOString().split('T')[0]
      return { start, end, meses: 6 }
    }
    case 'anio': {
      const start = new Date(y, m - 11, 1).toISOString().split('T')[0]
      return { start, end, meses: 12 }
    }
  }
}

function getPrevMonthRange(): { start: string; end: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]
  const end = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  return { start, end }
}

function getCurrentMonthRange(): { start: string; end: string } {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0]
  return { start, end }
}

// ============================================================
// Comercial
// ============================================================

export async function getComercialData(periodo: Periodo = 'mes'): Promise<ComercialData | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const range = getPeriodRange(periodo)
  const prev = getPrevMonthRange()
  const curr = getCurrentMonthRange()

  const [
    oportunidadesRes,
    cobrosRes,
    cobrosPrevRes,
    configMetasRes,
    carteraRes,
    proyectosGanadosRes,
  ] = await Promise.all([
    // All opportunities (not filtered by date — pipeline is current state)
    supabase
      .from('oportunidades')
      .select('id, codigo, descripcion, etapa, valor_estimado, probabilidad, razon_perdida, created_at, fecha_cierre_estimada, empresa_id, empresas(nombre)')
      .eq('workspace_id', workspaceId),

    // Cobros current month
    supabase
      .from('cobros')
      .select('monto')
      .eq('workspace_id', workspaceId)
      .gte('fecha', curr.start)
      .lt('fecha', curr.end),

    // Cobros previous month
    supabase
      .from('cobros')
      .select('monto')
      .eq('workspace_id', workspaceId)
      .gte('fecha', prev.start)
      .lt('fecha', prev.end),

    // Metas
    supabase
      .from('config_metas')
      .select('meta_ventas_mensual, meta_recaudo_mensual')
      .eq('workspace_id', workspaceId)
      .single(),

    // Cartera aging
    supabase
      .from('v_cartera_antiguedad')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single(),

    // Projects created from won opportunities (for close time calculation)
    supabase
      .from('proyectos')
      .select('created_at, oportunidad_id')
      .eq('workspace_id', workspaceId)
      .not('oportunidad_id', 'is', null),
  ])

  const opps = oportunidadesRes.data || []
  const cobros = cobrosRes.data || []
  const cobrosPrev = cobrosPrevRes.data || []

  // Ventas = cobros del mes
  const ventasMes = cobros.reduce((s, c) => s + Number(c.monto), 0)
  const ventasPrev = cobrosPrev.reduce((s, c) => s + Number(c.monto), 0)
  const ventasDelta = ventasPrev > 0 ? ((ventasMes - ventasPrev) / ventasPrev) * 100 : 0

  // Pipeline by stage
  const stageMap = new Map<string, { count: number; valor: number }>()
  for (const etapa of ETAPA_ORDER) {
    stageMap.set(etapa, { count: 0, valor: 0 })
  }
  for (const o of opps) {
    const e = o.etapa || 'lead'
    const existing = stageMap.get(e) || { count: 0, valor: 0 }
    existing.count++
    existing.valor += Number(o.valor_estimado || 0)
    stageMap.set(e, existing)
  }
  const pipeline: PipelineStage[] = ETAPA_ORDER.map(e => ({
    etapa: ETAPA_LABELS[e] || e,
    count: stageMap.get(e)?.count || 0,
    valor: stageMap.get(e)?.valor || 0,
  }))

  // Conversion rate
  const ganados = opps.filter(o => o.etapa === 'ganado').length
  const perdidos = opps.filter(o => o.etapa === 'perdido').length
  const conversionRate = (ganados + perdidos) > 0 ? (ganados / (ganados + perdidos)) * 100 : 0

  // Avg close time
  const proyectosGanados = proyectosGanadosRes.data || []
  const closeTimes: number[] = []
  for (const p of proyectosGanados) {
    const opp = opps.find(o => o.id === p.oportunidad_id)
    if (opp && p.created_at && opp.created_at) {
      const days = Math.round((new Date(p.created_at).getTime() - new Date(opp.created_at).getTime()) / (1000 * 60 * 60 * 24))
      if (days >= 0) closeTimes.push(days)
    }
  }
  const avgCloseTimeDays = closeTimes.length > 0 ? Math.round(closeTimes.reduce((a, b) => a + b, 0) / closeTimes.length) : 0

  // Razones perdida
  const razonesMap = new Map<string, number>()
  for (const o of opps.filter(o => o.etapa === 'perdido' && o.razon_perdida)) {
    razonesMap.set(o.razon_perdida!, (razonesMap.get(o.razon_perdida!) || 0) + 1)
  }
  const razonesPerdida: RazonPerdida[] = Array.from(razonesMap.entries())
    .map(([razon, count]) => ({ razon, count }))
    .sort((a, b) => b.count - a.count)

  // Top 5 open opportunities
  const abiertas = opps
    .filter(o => !['ganado', 'perdido'].includes(o.etapa || ''))
    .sort((a, b) => Number(b.valor_estimado || 0) - Number(a.valor_estimado || 0))
    .slice(0, 5)

  const topOportunidades: TopOportunidad[] = abiertas.map(o => ({
    id: o.id,
    nombre: o.descripcion || o.codigo || '',
    empresa: (o.empresas as any)?.nombre || '',
    valor: Number(o.valor_estimado || 0),
    etapa: ETAPA_LABELS[o.etapa || ''] || o.etapa || '',
    diasAbierta: o.created_at ? Math.round((Date.now() - new Date(o.created_at).getTime()) / (1000 * 60 * 60 * 24)) : 0,
  }))

  // Cartera
  const carteraData = carteraRes.data
  const cartera = carteraData ? {
    rango_0_30: Number(carteraData.rango_0_30 || 0),
    rango_31_60: Number(carteraData.rango_31_60 || 0),
    rango_61_90: Number(carteraData.rango_61_90 || 0),
    rango_90_plus: Number(carteraData.rango_90_plus || 0),
    total: Number(carteraData.total_cartera || 0),
  } : { rango_0_30: 0, rango_31_60: 0, rango_61_90: 0, rango_90_plus: 0, total: 0 }

  return {
    ventasMes,
    metaVentas: configMetasRes.data?.meta_ventas_mensual ?? null,
    ventasDelta,
    recaudoMes: ventasMes,
    metaRecaudo: configMetasRes.data?.meta_recaudo_mensual ?? null,
    pipeline,
    conversionRate,
    avgCloseTimeDays,
    ganados,
    perdidos,
    razonesPerdida,
    topOportunidades,
    cartera,
  }
}

// ============================================================
// Operativo
// ============================================================

export async function getOperativoData(periodo: Periodo = 'mes'): Promise<OperativoData | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const curr = getCurrentMonthRange()

  const [
    proyectosFinRes,
    proyectosRes,
    gastosRes,
    staffRes,
    horasRes,
  ] = await Promise.all([
    // Financial view for all active projects
    supabase
      .from('v_proyecto_financiero')
      .select('*')
      .eq('workspace_id', workspaceId),

    // Projects for estado count + completados
    supabase
      .from('proyectos')
      .select('id, estado, updated_at')
      .eq('workspace_id', workspaceId),

    // Gastos del mes por categoria
    supabase
      .from('gastos')
      .select('monto, categoria')
      .eq('workspace_id', workspaceId)
      .gte('fecha', curr.start)
      .lt('fecha', curr.end),

    // Staff activo
    supabase
      .from('staff')
      .select('id, full_name, horas_disponibles_mes')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true),

    // Horas del mes
    supabase
      .from('horas')
      .select('staff_id, horas')
      .eq('workspace_id', workspaceId)
      .gte('fecha', curr.start)
      .lt('fecha', curr.end),
  ])

  const proyectos = proyectosRes.data || []
  const proyectosFin = proyectosFinRes.data || []
  const gastos = gastosRes.data || []
  const staffList = staffRes.data || []
  const horas = horasRes.data || []

  // Proyectos por estado
  const estadoMap = new Map<string, number>()
  for (const p of proyectos) {
    estadoMap.set(p.estado, (estadoMap.get(p.estado) || 0) + 1)
  }
  const proyectosPorEstado: ProyectoEstado[] = Object.keys(ESTADO_LABELS).map(e => ({
    estado: ESTADO_LABELS[e],
    count: estadoMap.get(e) || 0,
  })).filter(e => e.count > 0)

  // Completados este mes
  const completadosMes = proyectos.filter(p =>
    ['completado', 'cerrado'].includes(p.estado) &&
    p.updated_at && p.updated_at >= curr.start && p.updated_at < curr.end
  ).length

  // Promedios presupuesto y horas (solo proyectos activos)
  const activos = proyectosFin.filter(p =>
    ['en_ejecucion', 'rework'].includes(p.estado || '')
  )
  const presupuestos = activos.map(p => Number(p.presupuesto_consumido_pct || 0))
  const promedioPresupuestoConsumido = presupuestos.length > 0
    ? presupuestos.reduce((a, b) => a + b, 0) / presupuestos.length
    : 0

  const horasPromedios = activos
    .filter(p => Number(p.horas_estimadas) > 0)
    .map(p => (Number(p.horas_reales) / Number(p.horas_estimadas)) * 100)
  const promedioHorasConsumidas = horasPromedios.length > 0
    ? horasPromedios.reduce((a, b) => a + b, 0) / horasPromedios.length
    : 0

  // Proyectos en riesgo (>90% presupuesto O >90% horas)
  const proyectosEnRiesgo: ProyectoRiesgo[] = activos
    .filter(p => {
      const presPct = Number(p.presupuesto_consumido_pct || 0)
      const horasPct = Number(p.horas_estimadas) > 0
        ? (Number(p.horas_reales) / Number(p.horas_estimadas)) * 100
        : 0
      return presPct > 90 || horasPct > 90
    })
    .map(p => ({
      id: p.proyecto_id || '',
      nombre: p.nombre || '',
      presupuestoPct: Number(p.presupuesto_consumido_pct || 0),
      horasPct: Number(p.horas_estimadas) > 0
        ? (Number(p.horas_reales) / Number(p.horas_estimadas)) * 100
        : 0,
    }))

  // Gastos por categoria
  const catMap = new Map<string, number>()
  for (const g of gastos) {
    const cat = g.categoria || 'otros'
    catMap.set(cat, (catMap.get(cat) || 0) + Number(g.monto))
  }
  const gastosPorCategoria: GastoCategoria[] = Array.from(catMap.entries())
    .map(([categoria, monto]) => ({
      categoria: CATEGORIA_LABELS[categoria] || categoria,
      monto,
    }))
    .sort((a, b) => b.monto - a.monto)

  // Productividad equipo
  const horasPorStaff = new Map<string, number>()
  for (const h of horas) {
    if (h.staff_id) {
      horasPorStaff.set(h.staff_id, (horasPorStaff.get(h.staff_id) || 0) + Number(h.horas))
    }
  }
  const productividadEquipo: StaffProductividad[] = staffList.map(s => {
    const registradas = horasPorStaff.get(s.id) || 0
    const disponibles = Number(s.horas_disponibles_mes || 160)
    return {
      nombre: s.full_name || '',
      horasRegistradas: registradas,
      horasDisponibles: disponibles,
      utilizacion: disponibles > 0 ? (registradas / disponibles) * 100 : 0,
    }
  }).sort((a, b) => b.utilizacion - a.utilizacion)

  return {
    proyectosPorEstado,
    completadosMes,
    promedioPresupuestoConsumido,
    promedioHorasConsumidas,
    proyectosEnRiesgo,
    gastosPorCategoria,
    productividadEquipo,
  }
}

// ============================================================
// Financiero
// ============================================================

export async function getFinancieroData(periodo: Periodo = '6meses'): Promise<FinancieroData | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const range = getPeriodRange(periodo)
  const curr = getCurrentMonthRange()
  const prev = getPrevMonthRange()

  const [
    saldoRes,
    cobrosHistRes,
    gastosHistRes,
    gastosFijosRes,
    staffRes,
    proyectosFinRes,
    fiscalRes,
    gastosPrevRes,
    gastosCurrRes,
  ] = await Promise.all([
    // Latest bank balance
    supabase
      .from('saldos_banco')
      .select('saldo_real, saldo_teorico, diferencia')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1),

    // Cobros in range (for monthly trend)
    supabase
      .from('cobros')
      .select('monto, fecha')
      .eq('workspace_id', workspaceId)
      .gte('fecha', range.start)
      .lt('fecha', range.end),

    // Gastos in range (for monthly trend)
    supabase
      .from('gastos')
      .select('monto, fecha, categoria')
      .eq('workspace_id', workspaceId)
      .gte('fecha', range.start)
      .lt('fecha', range.end),

    // Gastos fijos config
    supabase
      .from('gastos_fijos_config')
      .select('monto_referencia')
      .eq('workspace_id', workspaceId)
      .eq('activo', true),

    // Staff for nomina
    supabase
      .from('staff')
      .select('salary')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true),

    // Projects financial view for facturado vs cobrado
    supabase
      .from('v_proyecto_financiero')
      .select('nombre, facturado, cobrado')
      .eq('workspace_id', workspaceId)
      .gt('facturado', 0),

    // Fiscal profile
    supabase
      .from('fiscal_profiles')
      .select('person_type, tax_regime')
      .eq('workspace_id', workspaceId)
      .single(),

    // Gastos prev month by categoria
    supabase
      .from('gastos')
      .select('monto, categoria')
      .eq('workspace_id', workspaceId)
      .gte('fecha', prev.start)
      .lt('fecha', prev.end),

    // Gastos current month by categoria
    supabase
      .from('gastos')
      .select('monto, categoria')
      .eq('workspace_id', workspaceId)
      .gte('fecha', curr.start)
      .lt('fecha', curr.end),
  ])

  const saldo = saldoRes.data?.[0]
  const cobrosHist = cobrosHistRes.data || []
  const gastosHist = gastosHistRes.data || []
  const gastosFijos = gastosFijosRes.data || []
  const staff = staffRes.data || []
  const proyectosFin = proyectosFinRes.data || []

  // Saldo
  const saldoActual = Number(saldo?.saldo_real || 0)
  const diferenciaTeoricoReal = Number(saldo?.diferencia || 0)

  // Monthly trend
  const monthlyMap = new Map<string, { ingresos: number; egresos: number }>()
  for (const c of cobrosHist) {
    const mes = (c.fecha as string).slice(0, 7)
    const entry = monthlyMap.get(mes) || { ingresos: 0, egresos: 0 }
    entry.ingresos += Number(c.monto)
    monthlyMap.set(mes, entry)
  }
  for (const g of gastosHist) {
    const mes = (g.fecha as string).slice(0, 7)
    const entry = monthlyMap.get(mes) || { ingresos: 0, egresos: 0 }
    entry.egresos += Number(g.monto)
    monthlyMap.set(mes, entry)
  }

  const ingresosVsEgresos: MesIngresosEgresos[] = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, data]) => ({
      mes,
      label: MES_LABELS[parseInt(mes.split('-')[1]) - 1] || mes,
      ingresos: data.ingresos,
      egresos: data.egresos,
      margen: data.ingresos > 0 ? ((data.ingresos - data.egresos) / data.ingresos) * 100 : 0,
    }))

  const margenPromedio = ingresosVsEgresos.length > 0
    ? ingresosVsEgresos.reduce((s, m) => s + m.margen, 0) / ingresosVsEgresos.length
    : 0

  // Costos fijos
  const componenteOperativo = gastosFijos.reduce((s, g) => s + Number(g.monto_referencia || 0), 0)
  const componenteNomina = staff.reduce((s, s2) => s + Number(s2.salary || 0), 0)
  const costosFijos = componenteNomina + componenteOperativo

  // Runway
  const totalEgresos3m = gastosHist
    .filter(g => {
      const d = new Date(g.fecha as string)
      const threeMonthsAgo = new Date()
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
      return d >= threeMonthsAgo
    })
    .reduce((s, g) => s + Number(g.monto), 0)
  const gastoPromedioMensual = totalEgresos3m / 3
  const gastoTotalMensual = gastoPromedioMensual + costosFijos
  const runwayMeses = gastoTotalMensual > 0 ? saldoActual / gastoTotalMensual : 99

  // Top categorias gasto (current vs prev month)
  const currCatMap = new Map<string, number>()
  for (const g of (gastosCurrRes.data || [])) {
    const cat = g.categoria || 'otros'
    currCatMap.set(cat, (currCatMap.get(cat) || 0) + Number(g.monto))
  }
  const prevCatMap = new Map<string, number>()
  for (const g of (gastosPrevRes.data || [])) {
    const cat = g.categoria || 'otros'
    prevCatMap.set(cat, (prevCatMap.get(cat) || 0) + Number(g.monto))
  }
  const allCats = new Set([...currCatMap.keys(), ...prevCatMap.keys()])
  const topCategoriasGasto: CategoriaGasto[] = Array.from(allCats)
    .map(cat => ({
      categoria: CATEGORIA_LABELS[cat] || cat,
      monto: currCatMap.get(cat) || 0,
      montoAnterior: prevCatMap.get(cat) || 0,
    }))
    .sort((a, b) => b.monto - a.monto)
    .slice(0, 5)

  // Facturado vs cobrado
  const facturadoVsCobrado: ProyectoFacturacion[] = proyectosFin
    .map(p => {
      const facturado = Number(p.facturado || 0)
      const cobrado = Number(p.cobrado || 0)
      return {
        nombre: p.nombre || '',
        facturado,
        cobrado,
        cartera: facturado - cobrado,
      }
    })
    .sort((a, b) => b.facturado - a.facturado)

  // Impuestos estimados (simplified)
  const fiscal = fiscalRes.data
  let impuestos = null
  if (fiscal?.tax_regime) {
    const ingresosMes = cobrosHist
      .filter(c => (c.fecha as string) >= curr.start && (c.fecha as string) < curr.end)
      .reduce((s, c) => s + Number(c.monto), 0)
    impuestos = {
      reteFuente: ingresosMes * 0.11,
      ica: ingresosMes * 0.00966,
      iva: ingresosMes * 0.19,
    }
  }

  return {
    saldoActual,
    diferenciaTeoricoReal,
    runwayMeses,
    ingresosVsEgresos,
    margenPromedio,
    costosFijos,
    componenteNomina,
    componenteOperativo,
    topCategoriasGasto,
    facturadoVsCobrado,
    impuestos,
  }
}
