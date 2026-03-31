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

    // Projects financial view for cartera (facturado > cobrado)
    supabase
      .from('v_proyecto_financiero')
      .select('nombre, facturado, cobrado, proyecto_id, created_at')
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

  // Cartera pendiente por proyecto
  const now = new Date()
  const carteraPendiente: ProyectoCartera[] = proyectosFin
    .map(p => {
      const facturado = Number(p.facturado || 0)
      const cobrado = Number(p.cobrado || 0)
      const cartera = facturado - cobrado
      // Usar created_at del proyecto como proxy para dias de atraso
      const diasAtraso = p.created_at
        ? Math.max(0, Math.round((now.getTime() - new Date(p.created_at as string).getTime()) / (1000 * 60 * 60 * 24)))
        : 0
      return { nombre: p.nombre || '', facturado, cobrado, cartera, diasAtraso }
    })
    .filter(p => p.cartera > 0)
    .sort((a, b) => b.cartera - a.cartera)
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

export async function getComercialData(periodo: Periodo = 'mes'): Promise<ComercialData | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const curr = getCurrentMonthRange()
  const prev = getPrevMonthRange()

  const [
    oportunidadesRes,
    cobrosRes,
    cobrosPrevRes,
    configMetasRes,
    etapaHistorialRes,
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

    // Etapa historial para calcular dias sin movimiento y ritmo
    supabase
      .from('etapa_historial')
      .select('oportunidad_id, etapa_anterior, etapa_nueva, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false }),

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
  const historial = etapaHistorialRes.data || []

  // Recaudo
  const recaudoMes = cobros.reduce((s, c) => s + Number(c.monto), 0)
  const recaudoPrev = cobrosPrev.reduce((s, c) => s + Number(c.monto), 0)
  const recaudoDelta = recaudoPrev > 0 ? ((recaudoMes - recaudoPrev) / recaudoPrev) * 100 : 0

  // Pipeline by stage (solo activas)
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
  const pipeline: PipelineStage[] = ETAPA_ORDER
    .filter(e => !['ganado', 'perdido'].includes(e))
    .map(e => ({
      etapa: ETAPA_LABELS[e] || e,
      count: stageMap.get(e)?.count || 0,
      valor: stageMap.get(e)?.valor || 0,
    }))
    .filter(p => p.count > 0 || p.valor > 0)

  // Conversion rate
  const ganados = opps.filter(o => o.etapa === 'ganado').length
  const perdidos = opps.filter(o => o.etapa === 'perdido').length
  const totalOportunidadesCerradas = ganados + perdidos
  const conversionRate = totalOportunidadesCerradas > 0 ? (ganados / totalOportunidadesCerradas) * 100 : 0

  // Razones perdida
  const razonesMap = new Map<string, number>()
  for (const o of opps.filter(o => o.etapa === 'perdido' && o.razon_perdida)) {
    razonesMap.set(o.razon_perdida!, (razonesMap.get(o.razon_perdida!) || 0) + 1)
  }
  const razonesPerdida: RazonPerdida[] = Array.from(razonesMap.entries())
    .map(([razon, count]) => ({ razon, count }))
    .sort((a, b) => b.count - a.count)

  // Ultimo movimiento por oportunidad (desde etapa_historial)
  const ultimoMovimientoMap = new Map<string, string>()
  for (const h of historial) {
    if (h.oportunidad_id && !ultimoMovimientoMap.has(h.oportunidad_id)) {
      ultimoMovimientoMap.set(h.oportunidad_id, h.created_at as string)
    }
  }

  // Oportunidades urgentes
  const abiertas = opps.filter(o => !['ganado', 'perdido'].includes(o.etapa || ''))
  const valoresOrdenados = abiertas.map(o => Number(o.valor_estimado || 0)).sort((a, b) => a - b)
  const p75Index = Math.floor(valoresOrdenados.length * 0.75)
  const percentil75 = valoresOrdenados[p75Index] || 0

  const now = new Date()
  const mesActualStart = curr.start
  const mesActualEnd = curr.end

  const oportunidadesUrgentes: OportunidadUrgente[] = []
  for (const o of abiertas) {
    const razones: OportunidadUrgente['razones'] = []
    const ultimoMovimiento = ultimoMovimientoMap.get(o.id)
    const diasSinMovimiento = ultimoMovimiento
      ? Math.round((now.getTime() - new Date(ultimoMovimiento).getTime()) / (1000 * 60 * 60 * 24))
      : Math.round((now.getTime() - new Date(o.created_at as string).getTime()) / (1000 * 60 * 60 * 24))

    if (diasSinMovimiento > 15) razones.push('estancada')

    const fechaCierre = o.fecha_cierre_estimada as string | null
    if (
      fechaCierre &&
      fechaCierre >= mesActualStart &&
      fechaCierre < mesActualEnd &&
      o.etapa !== 'negociacion'
    ) {
      razones.push('cierre_proximo')
    }

    const valor = Number(o.valor_estimado || 0)
    if (valor > percentil75 && percentil75 > 0) razones.push('alto_valor')

    if (razones.length > 0) {
      oportunidadesUrgentes.push({
        id: o.id,
        nombre: o.descripcion || o.codigo || '',
        empresa: (o.empresas as any)?.nombre || '',
        valor,
        etapa: ETAPA_LABELS[o.etapa || ''] || o.etapa || '',
        razones,
        diasSinMovimiento,
      })
    }
  }

  // Ritmo del embudo
  let ritmoPipeline: RitmoPipeline | null = null
  if (historial.length >= 3) {
    // Dias promedio por etapa (tiempo entre transiciones)
    const etapaDias = new Map<string, number[]>()
    // Agrupar por oportunidad para calcular tiempo en cada etapa
    const histPorOpp = new Map<string, typeof historial>()
    for (const h of historial) {
      if (!h.oportunidad_id) continue
      const arr = histPorOpp.get(h.oportunidad_id) || []
      arr.push(h)
      histPorOpp.set(h.oportunidad_id, arr)
    }
    for (const [, rows] of histPorOpp) {
      const sorted = rows.sort((a, b) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime())
      for (let i = 0; i < sorted.length - 1; i++) {
        const etapa = sorted[i].etapa_nueva || sorted[i].etapa_anterior || 'lead'
        const dias = Math.round(
          (new Date(sorted[i + 1].created_at as string).getTime() - new Date(sorted[i].created_at as string).getTime()) /
          (1000 * 60 * 60 * 24)
        )
        if (dias >= 0) {
          const arr = etapaDias.get(etapa) || []
          arr.push(dias)
          etapaDias.set(etapa, arr)
        }
      }
    }

    let etapaMasLenta = 'lead'
    let diasPromedioMax = 0
    for (const [etapa, dias] of etapaDias) {
      const prom = dias.reduce((a, b) => a + b, 0) / dias.length
      if (prom > diasPromedioMax) {
        diasPromedioMax = prom
        etapaMasLenta = etapa
      }
    }

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const sevenDaysAgoStr = sevenDaysAgo.toISOString()
    const transicionesEstaSemana = historial.filter(h => (h.created_at as string) >= sevenDaysAgoStr).length

    // Cierres mes anterior
    const cierresMesAnterior = historial.filter(h =>
      h.etapa_nueva === 'ganado' &&
      (h.created_at as string) >= prev.start &&
      (h.created_at as string) < prev.end
    ).length

    // Dias promedio de cierre (desde created_at opp hasta ganado)
    const proyectosGanados = proyectosGanadosRes.data || []
    const closeTimes: number[] = []
    for (const p of proyectosGanados) {
      const opp = opps.find(o => o.id === p.oportunidad_id)
      if (opp && p.created_at && opp.created_at) {
        const days = Math.round((new Date(p.created_at as string).getTime() - new Date(opp.created_at as string).getTime()) / (1000 * 60 * 60 * 24))
        if (days >= 0) closeTimes.push(days)
      }
    }
    const diasPromedioCierre = closeTimes.length > 0
      ? Math.round(closeTimes.reduce((a, b) => a + b, 0) / closeTimes.length)
      : 0

    ritmoPipeline = {
      etapaMasLenta: ETAPA_LABELS[etapaMasLenta] || etapaMasLenta,
      diasPromedioEtapaMasLenta: Math.round(diasPromedioMax),
      transicionesEstaSemana,
      cierresMesAnterior,
      diasPromedioCierre,
    }
  }

  // ROI por canal (solo si >= 10 cerradas)
  let canalesAdquisicion: CanalAdquisicion[] | null = null
  if (totalOportunidadesCerradas >= 10) {
    // Necesitaria JOIN con contactos.fuente_adquisicion — simplificamos
    // agrupando oportunidades por fuente si el campo existe en la tabla
    const canalMap = new Map<string, { total: number; ganadas: number }>()
    for (const o of opps.filter(o => ['ganado', 'perdido'].includes(o.etapa || ''))) {
      const canal = (o as any).fuente_adquisicion || 'directo'
      const entry = canalMap.get(canal) || { total: 0, ganadas: 0 }
      entry.total++
      if (o.etapa === 'ganado') entry.ganadas++
      canalMap.set(canal, entry)
    }
    canalesAdquisicion = Array.from(canalMap.entries())
      .map(([canal, data]) => ({
        canal,
        total: data.total,
        ganadas: data.ganadas,
        conversionRate: data.total > 0 ? (data.ganadas / data.total) * 100 : 0,
      }))
      .sort((a, b) => b.conversionRate - a.conversionRate)
  }

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

export async function getOperativoData(periodo: Periodo = 'mes'): Promise<OperativoData | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const curr = getCurrentMonthRange()

  const [
    proyectosFinRes,
    proyectosRes,
    staffRes,
    horasRes,
    proyectosFinCerradosRes,
  ] = await Promise.all([
    // Financial view for active projects
    supabase
      .from('v_proyecto_financiero')
      .select('*')
      .eq('workspace_id', workspaceId)
      .in('estado', ['en_ejecucion', 'rework', 'pausado']),

    // All projects for estado count + completados + alertas
    supabase
      .from('proyectos')
      .select('id, estado, updated_at, nombre, fecha_entrega_estimada, avance_porcentaje, fecha_inicio, fecha_fin_estimada')
      .eq('workspace_id', workspaceId),

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

    // Proyectos cerrados para rentabilidad
    supabase
      .from('v_proyecto_financiero')
      .select('proyecto_id, nombre, facturado, gastos_directos, ganancia_actual, fecha_cierre, updated_at')
      .eq('workspace_id', workspaceId)
      .in('estado', ['completado', 'cerrado'])
      .order('updated_at', { ascending: false })
      .limit(10),
  ])

  const proyectos = proyectosRes.data || []
  const proyectosFin = proyectosFinRes.data || []
  const staffList = staffRes.data || []
  const horas = horasRes.data || []
  const proyectosFinCerrados = proyectosFinCerradosRes.data || []

  // Proyectos por estado
  const estadoMap = new Map<string, number>()
  for (const p of proyectos) {
    estadoMap.set(p.estado, (estadoMap.get(p.estado) || 0) + 1)
  }
  const proyectosPorEstado: ProyectoEstado[] = Object.keys(ESTADO_LABELS)
    .map(e => ({
      estado: ESTADO_LABELS[e],
      count: estadoMap.get(e) || 0,
    }))
    .filter(e => e.count > 0)

  // Completados este mes
  const completadosMes = proyectos.filter(p =>
    ['completado', 'cerrado'].includes(p.estado) &&
    p.updated_at && p.updated_at >= curr.start && p.updated_at < curr.end
  ).length

  // Activos para metricas
  const activos = proyectosFin.filter(p =>
    ['en_ejecucion', 'rework'].includes(p.estado || '')
  )
  const totalProyectosActivos = activos.length

  // Promedios presupuesto y horas
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

  // Proyectos en riesgo presupuesto y horas
  const proyectosEnRiesgoPresupuesto = activos.filter(p => Number(p.presupuesto_consumido_pct || 0) > 80).length
  const proyectosEnRiesgoHoras = activos.filter(p => {
    const est = Number(p.horas_estimadas)
    if (est <= 0) return false
    return (Number(p.horas_reales) / est) * 100 > 80
  }).length

  // Salud: saludables = presupuesto < 70% Y horas < 70%
  const proyectosSaludables = activos.filter(p => {
    const presPct = Number(p.presupuesto_consumido_pct || 0)
    const est = Number(p.horas_estimadas)
    const horasPct = est > 0 ? (Number(p.horas_reales) / est) * 100 : 0
    return presPct < 70 && (est <= 0 || horasPct < 70)
  }).length
  const saludPct = activos.length > 0 ? (proyectosSaludables / activos.length) * 100 : 100

  // Alertas unificadas
  const now7dias = new Date()
  now7dias.setDate(now7dias.getDate() + 7)
  const now7str = now7dias.toISOString().split('T')[0]
  const nowStr = new Date().toISOString().split('T')[0]

  const alertas: AlertaProyecto[] = []
  for (const p of activos) {
    const tipo: AlertaProyecto['tipo'] = []
    const presPct = Number(p.presupuesto_consumido_pct || 0)
    const est = Number(p.horas_estimadas)
    const horasPct = est > 0 ? (Number(p.horas_reales) / est) * 100 : 0

    if (presPct > 90) tipo.push('presupuesto')
    if (est > 0 && horasPct > 90) tipo.push('horas')

    // Buscar datos del proyecto base para fecha entrega y avance
    const proyBase = proyectos.find(pb => pb.id === p.proyecto_id)
    let diasParaEntrega: number | undefined
    if (proyBase?.fecha_entrega_estimada) {
      const diasDiff = Math.round(
        (new Date(proyBase.fecha_entrega_estimada).getTime() - new Date(nowStr).getTime()) / (1000 * 60 * 60 * 24)
      )
      if (diasDiff >= 0 && diasDiff <= 7) {
        tipo.push('entrega_proxima')
        diasParaEntrega = diasDiff
      }
    }

    // Avance bajo: avance < 50% pero tiempo transcurrido > 75%
    const avancePct = Number(proyBase?.avance_porcentaje ?? 0)
    if (
      proyBase?.fecha_inicio && proyBase?.fecha_fin_estimada && avancePct < 50
    ) {
      const inicio = new Date(proyBase.fecha_inicio).getTime()
      const fin = new Date(proyBase.fecha_fin_estimada).getTime()
      const ahora = Date.now()
      const tiempoTranscurrido = fin > inicio ? (ahora - inicio) / (fin - inicio) : 0
      if (tiempoTranscurrido > 0.75) tipo.push('avance_bajo')
    }

    if (tipo.length > 0) {
      alertas.push({
        id: p.proyecto_id || '',
        nombre: p.nombre || '',
        tipo,
        presupuestoPct: presPct,
        horasPct: est > 0 ? horasPct : undefined,
        diasParaEntrega,
        avancePct,
      })
    }
  }

  // Rentabilidad cerrados
  const rentabilidadCerrados: RentabilidadProyecto[] = proyectosFinCerrados
    .map(p => {
      const facturado = Number(p.facturado || 0)
      const margenPct = facturado > 0 ? (Number(p.ganancia_actual || 0) / facturado) * 100 : 0
      return {
        nombre: p.nombre || '',
        margenPct,
        fechaCierre: (p.fecha_cierre || p.updated_at || '') as string,
      }
    })
    .filter(p => p.nombre)

  // Costo por proyecto (activos)
  const costoPorProyecto: CostoProyecto[] = activos
    .map(p => ({
      id: p.proyecto_id || '',
      nombre: p.nombre || '',
      presupuesto: Number(p.presupuesto_total || 0),
      gastoReal: Number(p.gastos_directos || 0),
      pct: Number(p.presupuesto_consumido_pct || 0),
    }))
    .filter(p => p.nombre)
    .sort((a, b) => b.pct - a.pct)

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
    proyectosActivos: activos.length,
    proyectosSaludables,
    alertas,
    proyectosPorEstado,
    completadosMes,
    promedioPresupuestoConsumido,
    promedioHorasConsumidas,
    proyectosEnRiesgoPresupuesto,
    proyectosEnRiesgoHoras,
    totalProyectosActivos,
    rentabilidadCerrados,
    costoPorProyecto,
    productividadEquipo,
  }
}
