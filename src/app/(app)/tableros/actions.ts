'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import type {
  ComercialData, OperativoData, FinancieroData,
  PipelineStage, RazonPerdida, OportunidadUrgente, RitmoPipeline, CanalAdquisicion,
  ProyectoEstado, AlertaProyecto, StaffProductividad, CostoProyecto, RentabilidadProyecto,
  MesIngresosEgresos, GastoAnomalo, ProyectoCartera,
  Periodo,
} from './types'

// ── Helpers ────────────────────────────────────────────────

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

function getDiasRestantesMes(): number {
  const now = new Date()
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return lastDay.getDate() - now.getDate()
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
    carteraRes,
    gastosPorPagarRes,
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

    // Gastos in range (for monthly trend + runway)
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

    // Negocios completados (for cartera proxy)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('negocios')
      .select('nombre, precio_aprobado, estado, closed_at')
      .eq('workspace_id', workspaceId)
      .eq('estado', 'completado'),

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

    // Cartera total (v_cartera_antiguedad)
    supabase
      .from('v_cartera_antiguedad')
      .select('total_cartera')
      .eq('workspace_id', workspaceId)
      .single(),

    // Gastos por pagar (estado_causacion = aprobado proxy para gastos pendientes de pago)
    supabase
      .from('gastos')
      .select('monto')
      .eq('workspace_id', workspaceId)
      .eq('estado_causacion', 'aprobado'),
  ])

  const saldo = saldoRes.data?.[0]
  const cobrosHist = cobrosHistRes.data || []
  const gastosHist = gastosHistRes.data || []
  const gastosFijos = gastosFijosRes.data || []
  const staff = staffRes.data || []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const negociosCerrados: any[] = proyectosFinRes.data || []

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

  // Flujo neto del mes actual
  const ingresosMes = cobrosHist
    .filter(c => (c.fecha as string) >= curr.start && (c.fecha as string) < curr.end)
    .reduce((s, c) => s + Number(c.monto), 0)
  const gastosMes = gastosHist
    .filter(g => (g.fecha as string) >= curr.start && (g.fecha as string) < curr.end)
    .reduce((s, g) => s + Number(g.monto), 0)
  const flujoNeto = ingresosMes - gastosMes

  const ingresosPrev = cobrosHist
    .filter(c => (c.fecha as string) >= prev.start && (c.fecha as string) < prev.end)
    .reduce((s, c) => s + Number(c.monto), 0)
  const gastosPrev2 = gastosHist
    .filter(g => (g.fecha as string) >= prev.start && (g.fecha as string) < prev.end)
    .reduce((s, g) => s + Number(g.monto), 0)
  const flujoPrev = ingresosPrev - gastosPrev2
  const flujoNetoDelta = flujoPrev !== 0 ? ((flujoNeto - flujoPrev) / Math.abs(flujoPrev)) * 100 : 0

  // Runway — usar últimos 3 meses de gastosHist
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
  const threeMonthsAgoStr = threeMonthsAgo.toISOString().split('T')[0]
  const totalEgresos3m = gastosHist
    .filter(g => (g.fecha as string) >= threeMonthsAgoStr)
    .reduce((s, g) => s + Number(g.monto), 0)
  const gastoPromedioMensual = totalEgresos3m / 3
  const gastoTotalMensual = gastoPromedioMensual + costosFijos
  const runwayMeses = gastoTotalMensual > 0 ? saldoActual / gastoTotalMensual : 99

  // Cartera pendiente — simplified using negocios completados
  const now = new Date()
  const carteraPendiente: ProyectoCartera[] = negociosCerrados
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((n: any) => {
      const precioAprobado = Number(n.precio_aprobado || 0)
      const diasAtraso = n.closed_at
        ? Math.max(0, Math.round((now.getTime() - new Date(n.closed_at as string).getTime()) / (1000 * 60 * 60 * 24)))
        : 0
      return { nombre: n.nombre || '', facturado: precioAprobado, cobrado: 0, cartera: precioAprobado, diasAtraso }
    })
    .filter((p: ProyectoCartera) => p.cartera > 0)
    .sort((a: ProyectoCartera, b: ProyectoCartera) => b.cartera - a.cartera)
    .slice(0, 5)

  // Posicion neta de caja
  const totalCarteraCobrar = Number(carteraRes.data?.total_cartera || 0)
  const totalGastosPorPagar = (gastosPorPagarRes.data || []).reduce((s, g) => s + Number(g.monto || 0), 0)
  const posicionNetaCaja = totalCarteraCobrar - totalGastosPorPagar

  // Gastos anómalos (categorias con delta > 20%)
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
  const gastosAnomalos: GastoAnomalo[] = Array.from(currCatMap.entries())
    .map(([cat, monto]) => {
      const montoAnterior = prevCatMap.get(cat) || 0
      const deltaPct = montoAnterior > 0 ? ((monto - montoAnterior) / montoAnterior) * 100 : 0
      return {
        categoria: CATEGORIA_LABELS[cat] || cat,
        monto,
        montoAnterior,
        deltaPct,
      }
    })
    .filter(g => g.deltaPct > 20)
    .sort((a, b) => b.deltaPct - a.deltaPct)

  // Impuestos estimados
  const fiscal = fiscalRes.data
  let impuestos = null
  if (fiscal?.tax_regime) {
    impuestos = {
      reteFuente: ingresosMes * 0.11,
      ica: ingresosMes * 0.00966,
      iva: ingresosMes * 0.19,
    }
  }

  return {
    flujoNeto,
    flujoNetoDelta,
    saldoActual,
    diferenciaTeoricoReal,
    runwayMeses,
    costosFijos,
    componenteNomina,
    componenteOperativo,
    ingresosVsEgresos,
    margenPromedio,
    carteraPendiente,
    totalCarteraCobrar,
    totalGastosPorPagar,
    posicionNetaCaja,
    gastosAnomalos,
    impuestos,
  }
}

// ============================================================
// Comercial
// ============================================================

export async function getComercialData(_periodo: Periodo = 'mes'): Promise<ComercialData | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const curr = getCurrentMonthRange()
  const prev = getPrevMonthRange()

  const [
    negociosRes,
    cobrosRes,
    cobrosPrevRes,
    configMetasRes,
    negociosCerradosRes,
  ] = await Promise.all([
    // All negocios (current state — not filtered by date)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('negocios')
      .select('id, codigo, nombre, stage_actual, estado, precio_estimado, precio_aprobado, razon_cierre, created_at, updated_at, empresa_id, empresas(nombre)')
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

    // Negocios cerrados para calcular close time
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('negocios')
      .select('created_at, closed_at')
      .eq('workspace_id', workspaceId)
      .eq('estado', 'completado'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const negs: any[] = negociosRes.data || []
  const cobros = cobrosRes.data || []
  const cobrosPrev = cobrosPrevRes.data || []

  // Recaudo
  const recaudoMes = cobros.reduce((s, c) => s + Number(c.monto), 0)
  const recaudoPrev = cobrosPrev.reduce((s, c) => s + Number(c.monto), 0)
  const recaudoDelta = recaudoPrev > 0 ? ((recaudoMes - recaudoPrev) / recaudoPrev) * 100 : 0

  // Pipeline by stage (solo negocios abiertos en venta)
  const STAGE_ORDER = ['venta', 'ejecucion', 'cobro', 'cierre']
  const STAGE_LABELS: Record<string, string> = {
    venta: 'En venta', ejecucion: 'Ejecucion', cobro: 'Cobro', cierre: 'Cierre',
  }
  const stageMap = new Map<string, { count: number; valor: number }>()
  for (const stage of STAGE_ORDER) {
    stageMap.set(stage, { count: 0, valor: 0 })
  }
  const negociosAbiertos = negs.filter(n => n.estado === 'abierto')
  for (const n of negociosAbiertos) {
    const s = n.stage_actual || 'venta'
    const existing = stageMap.get(s) || { count: 0, valor: 0 }
    existing.count++
    existing.valor += Number(n.precio_estimado || n.precio_aprobado || 0)
    stageMap.set(s, existing)
  }
  const pipeline: PipelineStage[] = STAGE_ORDER
    .map(s => ({
      etapa: STAGE_LABELS[s] || s,
      count: stageMap.get(s)?.count || 0,
      valor: stageMap.get(s)?.valor || 0,
    }))
    .filter(p => p.count > 0 || p.valor > 0)

  // Conversion rate
  const ganados = negs.filter(n => n.estado === 'completado').length
  const perdidos = negs.filter(n => n.estado === 'perdido').length
  const totalOportunidadesCerradas = ganados + perdidos
  const conversionRate = totalOportunidadesCerradas > 0 ? (ganados / totalOportunidadesCerradas) * 100 : 0

  // Razones perdida
  const razonesMap = new Map<string, number>()
  for (const n of negs.filter(n => n.estado === 'perdido' && n.razon_cierre)) {
    razonesMap.set(n.razon_cierre, (razonesMap.get(n.razon_cierre) || 0) + 1)
  }
  const razonesPerdida: RazonPerdida[] = Array.from(razonesMap.entries())
    .map(([razon, count]) => ({ razon, count }))
    .sort((a, b) => b.count - a.count)

  // Negocios urgentes (en venta, sin movimiento > 15 dias o alto valor)
  const enVenta = negociosAbiertos.filter(n => n.stage_actual === 'venta')
  const valoresOrdenados = enVenta.map(n => Number(n.precio_estimado || 0)).sort((a: number, b: number) => a - b)
  const p75Index = Math.floor(valoresOrdenados.length * 0.75)
  const percentil75 = valoresOrdenados[p75Index] || 0

  const now = new Date()

  const oportunidadesUrgentes: OportunidadUrgente[] = []
  for (const n of enVenta) {
    const razones: OportunidadUrgente['razones'] = []
    const diasSinMovimiento = n.updated_at
      ? Math.round((now.getTime() - new Date(n.updated_at as string).getTime()) / (1000 * 60 * 60 * 24))
      : Math.round((now.getTime() - new Date(n.created_at as string).getTime()) / (1000 * 60 * 60 * 24))

    if (diasSinMovimiento > 15) razones.push('estancada')

    const valor = Number(n.precio_estimado || 0)
    if (valor > percentil75 && percentil75 > 0) razones.push('alto_valor')

    if (razones.length > 0) {
      oportunidadesUrgentes.push({
        id: n.id,
        nombre: n.nombre || n.codigo || '',
        empresa: n.empresas?.nombre || '',
        valor,
        etapa: STAGE_LABELS[n.stage_actual || 'venta'] || n.stage_actual || '',
        razones,
        diasSinMovimiento,
      })
    }
  }

  // Ritmo pipeline — simplified (no etapa_historial for negocios yet)
  let ritmoPipeline: RitmoPipeline | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const negsCerrados: any[] = negociosCerradosRes.data || []
  if (negsCerrados.length >= 3) {
    const closeTimes: number[] = []
    for (const n of negsCerrados) {
      if (n.created_at && n.closed_at) {
        const days = Math.round((new Date(n.closed_at).getTime() - new Date(n.created_at).getTime()) / (1000 * 60 * 60 * 24))
        if (days >= 0) closeTimes.push(days)
      }
    }
    const diasPromedioCierre = closeTimes.length > 0
      ? Math.round(closeTimes.reduce((a: number, b: number) => a + b, 0) / closeTimes.length)
      : 0

    ritmoPipeline = {
      etapaMasLenta: 'Venta',
      diasPromedioEtapaMasLenta: 0,
      transicionesEstaSemana: 0,
      cierresMesAnterior: 0,
      diasPromedioCierre,
    }
  }

  // ROI por canal — omitted (negocios don't have fuente_adquisicion yet)
  const canalesAdquisicion: CanalAdquisicion[] | null = null

  return {
    recaudoMes,
    metaRecaudo: configMetasRes.data?.meta_recaudo_mensual ?? null,
    recaudoDelta,
    diasRestantesMes: getDiasRestantesMes(),
    pipeline,
    oportunidadesUrgentes,
    conversionRate,
    ganados,
    perdidos,
    razonesPerdida,
    ritmoPipeline,
    canalesAdquisicion,
    totalOportunidadesCerradas,
  }
}

// ============================================================
// Operativo
// ============================================================

export async function getOperativoData(_periodo: Periodo = 'mes'): Promise<OperativoData | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const curr = getCurrentMonthRange()

  const [
    negociosActivosRes,
    staffRes,
    horasRes,
    negociosCerradosRes,
  ] = await Promise.all([
    // Negocios activos (ejecucion + cobro)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('negocios')
      .select('id, nombre, codigo, estado, stage_actual, precio_aprobado, updated_at, created_at')
      .eq('workspace_id', workspaceId)
      .eq('estado', 'abierto')
      .in('stage_actual', ['ejecucion', 'cobro']),

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

    // Negocios cerrados para rentabilidad
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('negocios')
      .select('id, nombre, codigo, precio_aprobado, estado, closed_at, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('estado', 'completado')
      .order('updated_at', { ascending: false })
      .limit(10),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const negociosActivos: any[] = negociosActivosRes.data || []
  const staffList = staffRes.data || []
  const horas = horasRes.data || []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const negociosCerrados: any[] = negociosCerradosRes.data || []

  // Negocios por stage
  const STAGE_LABELS_OP: Record<string, string> = {
    venta: 'En venta', ejecucion: 'Ejecucion', cobro: 'Cobro', cierre: 'Cierre',
  }
  const stageMap = new Map<string, number>()
  for (const n of negociosActivos) {
    const stage = n.stage_actual || 'ejecucion'
    stageMap.set(stage, (stageMap.get(stage) || 0) + 1)
  }
  const proyectosPorEstado: ProyectoEstado[] = Object.keys(STAGE_LABELS_OP)
    .map(s => ({
      estado: STAGE_LABELS_OP[s],
      count: stageMap.get(s) || 0,
    }))
    .filter(e => e.count > 0)

  // Completados este mes
  const completadosMes = negociosCerrados.filter(n =>
    n.updated_at && n.updated_at >= curr.start && n.updated_at < curr.end
  ).length

  const totalProyectosActivos = negociosActivos.length

  // Simplified health: negocios without inactivity (updated in last 7 days) are healthy
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const proyectosSaludables = negociosActivos.filter(n =>
    n.updated_at && new Date(n.updated_at) >= sevenDaysAgo
  ).length
  const saludPct = totalProyectosActivos > 0 ? (proyectosSaludables / totalProyectosActivos) * 100 : 100

  // Alertas: inactividad (>7 dias sin update)
  const alertas: AlertaProyecto[] = []
  for (const n of negociosActivos) {
    const tipo: AlertaProyecto['tipo'] = []
    const diasInactivo = n.updated_at
      ? Math.round((now.getTime() - new Date(n.updated_at).getTime()) / (1000 * 60 * 60 * 24))
      : 999
    if (diasInactivo > 7) tipo.push('avance_bajo')

    if (tipo.length > 0) {
      alertas.push({
        id: n.id,
        nombre: n.nombre || n.codigo || '',
        tipo,
        presupuestoPct: 0,
        avancePct: 0,
      })
    }
  }

  // Rentabilidad cerrados — precio_aprobado as proxy
  const rentabilidadCerrados: RentabilidadProyecto[] = negociosCerrados
    .map(n => ({
      nombre: n.nombre || n.codigo || '',
      margenPct: 0, // No cost data available for negocios yet
      fechaCierre: (n.closed_at || n.updated_at || '') as string,
    }))
    .filter((p: RentabilidadProyecto) => p.nombre)

  // Costo por proyecto — simplified (no financial view for negocios)
  const costoPorProyecto: CostoProyecto[] = negociosActivos
    .map(n => ({
      id: n.id,
      nombre: n.nombre || n.codigo || '',
      presupuesto: Number(n.precio_aprobado || 0),
      gastoReal: 0,
      pct: 0,
    }))
    .filter((p: CostoProyecto) => p.nombre)

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
    saludPct,
    proyectosActivos: totalProyectosActivos,
    proyectosSaludables,
    alertas,
    proyectosPorEstado,
    completadosMes,
    promedioPresupuestoConsumido: 0,
    promedioHorasConsumidas: 0,
    proyectosEnRiesgoPresupuesto: 0,
    proyectosEnRiesgoHoras: 0,
    totalProyectosActivos,
    rentabilidadCerrados,
    costoPorProyecto,
    productividadEquipo,
  }
}
