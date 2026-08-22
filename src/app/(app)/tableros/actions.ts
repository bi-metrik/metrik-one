'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { bogotaParts, todayBogotaISO } from '@/lib/dates/bogota'
import { SECCIONALES_DIAN, canonizarSeccional } from '@/lib/dian/seccionales'
import { resumirCartera } from '@/lib/negocios/cartera'
import type {
  ComercialData, OperativoData, FinancieroData,
  PipelineStage, RazonPerdida, OportunidadUrgente, RitmoPipeline, CanalAdquisicion,
  ProyectoEstado, AlertaProyecto, StaffProductividad, CostoProyecto, RentabilidadProyecto,
  MesIngresosEgresos, GastoAnomalo, ProyectoCartera,
  Periodo, RentabilidadComercialData, RcFiltrosInput,
  ProcesoSemanalData, ProcesoEtapaFoto, ProcesoEtapaConDelta, ProcesoFoto,
  ProcesoSeccionalData, ProcesoSeccionalEtapa, EtapaStage,
} from './types'

// ── Helpers ────────────────────────────────────────────────

const CATEGORIA_LABELS: Record<string, string> = {
  materiales: 'Materiales', transporte: 'Transporte', servicios_profesionales: 'Servicios Prof.',
  viaticos: 'Viaticos', software: 'Software', impuestos_seguros: 'Impuestos/Seguros',
  mano_de_obra: 'Mano de obra', alimentacion: 'Alimentacion', otros: 'Otros',
}
const MES_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

// Rangos de mes calculados en zona Colombia — Vercel corre en UTC; ver src/lib/dates/bogota.ts.
function firstOfMonthBogota(yearMonthOffset: number = 0): string {
  const p = bogotaParts()
  const monthZeroBased = p.month - 1 + yearMonthOffset
  const y = p.year + Math.floor(monthZeroBased / 12)
  const m = ((monthZeroBased % 12) + 12) % 12 // 0-11
  return `${y}-${String(m + 1).padStart(2, '0')}-01`
}

function getPeriodRange(periodo: Periodo): { start: string; end: string; meses: number } {
  const end = firstOfMonthBogota(1)
  switch (periodo) {
    case 'mes':       return { start: firstOfMonthBogota(0),   end, meses: 1 }
    case 'trimestre': return { start: firstOfMonthBogota(-2),  end, meses: 3 }
    case '6meses':    return { start: firstOfMonthBogota(-5),  end, meses: 6 }
    case 'anio':      return { start: firstOfMonthBogota(-11), end, meses: 12 }
  }
}

function getPrevMonthRange(): { start: string; end: string } {
  return { start: firstOfMonthBogota(-1), end: firstOfMonthBogota(0) }
}

function getCurrentMonthRange(): { start: string; end: string } {
  return { start: firstOfMonthBogota(0), end: firstOfMonthBogota(1) }
}

function getDiasRestantesMes(): number {
  const p = bogotaParts()
  // Ultimo dia del mes en Bogota — local-Date con offsets seguros.
  const lastDay = new Date(p.year, p.month, 0).getDate()
  return lastDay - p.day
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

    // Gastos fijos (fixed_expenses = fuente única, misma tabla que Mi Negocio y /numeros)
    supabase
      .from('fixed_expenses')
      .select('monthly_amount')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true),

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
      .select('nombre, precio_aprobado, estado, closed_at, cierre_no_facturable')
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

    // Cartera total. La fuente era `v_cartera_antiguedad`, construida sobre
    // `facturas`, que tiene 0 filas en los 15 workspaces (medido 2026-08-22):
    // devolvia cero para todos. Ahora sale de `v_cartera_negocio`, la misma que
    // lee /numeros desde el PR #365 — honorario aprobado menos recaudado, solo
    // sobre negocios que ya se vendieron (#367). Ver 20260822000004/000005.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('v_cartera_negocio')
      .select('codigo, nombre, honorario, honorario_recaudado, saldo, dias')
      .eq('workspace_id', workspaceId),

    // Gastos por pagar (post-refactor 2026-04-27: todos los gastos son reales)
    supabase
      .from('gastos')
      .select('monto')
      .eq('workspace_id', workspaceId)
      .eq('estado_pago', 'pendiente'),
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
  const componenteOperativo = gastosFijos.reduce((s, g) => s + Number(g.monthly_amount || 0), 0)
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
  const threeMonthsAgoStr = todayBogotaISO(threeMonthsAgo)
  const totalEgresos3m = gastosHist
    .filter(g => (g.fecha as string) >= threeMonthsAgoStr)
    .reduce((s, g) => s + Number(g.monto), 0)
  const gastoPromedioMensual = totalEgresos3m / 3
  const gastoTotalMensual = gastoPromedioMensual + costosFijos
  const runwayMeses = gastoTotalMensual > 0 ? saldoActual / gastoTotalMensual : 99

  // Cartera pendiente — simplified using negocios completados
  // Un cierre no facturable NO es cartera: se cerro a proposito sin factura, asi
  // que su precio aprobado (que se conserva como historia comercial) no es plata
  // por cobrar. Sin este filtro, la excepcion inflaria la cartera del tablero.
  const now = new Date()
  const carteraPendiente: ProyectoCartera[] = negociosCerrados
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((n: any) => n.cierre_no_facturable !== true)
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
  // `resumirCartera` aplica el piso de materialidad de /conciliacion, el mismo
  // que usa /numeros: las dos pantallas dicen la misma cifra o no dicen nada.
  const totalCarteraCobrar = resumirCartera(carteraRes.data || []).carteraPendiente
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

// ── Rentabilidad Comercial ─────────────────────────────────
// Alimentado por ventas_hechos (grano linea de documento). Un solo RPC agrega
// KPIs + cortes por mes/linea/vendedor/producto, con RLS por workspace.
export async function getRentabilidadComercialData(
  f?: RcFiltrosInput,
): Promise<RentabilidadComercialData | null> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const sinFiltros = !f || (f.anio == null && f.mes == null && f.vendedor == null && f.linea == null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: rpcErr } = await (supabase as any).rpc('get_rentabilidad_comercial', {
    p_anio: f?.anio ?? null,
    p_mes: f?.mes ?? null,
    p_vendedor: f?.vendedor ?? null,
    p_linea: f?.linea ?? null,
  })
  if (rpcErr || !data) return null

  const d = data as RentabilidadComercialData
  // Sin filtros y sin ventas => workspace vacio (empty state global). Con filtros, devolvemos
  // aunque quede vacio para que la UI muestre "sin datos para este filtro".
  if (sinFiltros && (!d.kpis || Number(d.kpis.ventaNeta) === 0)) return null
  return d
}

// ── Proceso: foto semanal por etapa ─────────────────────────────────────────
// Responde la pregunta que Juan David (SOENA) puso en la reunion del 2026-07-24:
// "a la espera de pago UPME tengo 30 y la otra semana vamos en 28". El conteo de hoy
// sale en vivo de v_negocios_etapa_vencimiento; la comparacion contra semanas previas
// solo puede salir de proceso_snapshots, porque el historico no existia en ningun lado
// (etapa_historial esta vacia y apunta al modulo pipeline extirpado, y activity_log
// guarda el NOMBRE de la etapa, que ya cambio con el renombre del 2026-07-28).
//
// Decision de Mauricio (2026-07-28): la serie arranca vacia y se llena hacia adelante.
// No se reconstruye el pasado: serian numeros que nadie puede validar.
export async function getProcesoSemanal(semanas = 8): Promise<ProcesoSemanalData | null> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!supabase || !workspaceId) return null

  // ⚠️ El `orden` de una etapa NO es la secuencia del proceso. Las etapas nuevas se
  // insertaron al final del orden para no correr las existentes, asi que Cita,
  // Notificacion y Anexos quedaron en 16/17/18 aunque van ANTES de Generacion, Envio y
  // Facturacion (13/14/15). Ordenar por `orden` muestra el proceso al reves: Facturacion
  // en la mitad y la Cita despues del cierre. El `numero` si es la secuencia real.
  const { data: etapasRows } = await supabase
    .from('etapas_negocio')
    .select('id, numero')

  const numeroPorEtapa = new Map<string, number>(
    ((etapasRows ?? []) as Array<{ id: string; numero: number | null }>)
      .map(e => [e.id, e.numero ?? 0]),
  )

  // Foto de hoy: en vivo, no del snapshot. Asi la pantalla nunca muestra un dato
  // rancio si el cron no ha corrido todavia.
  const { data: hoyRows } = await supabase
    .from('v_negocios_etapa_vencimiento')
    .select('etapa_id, etapa_nombre, etapa_orden, abiertos, vencidos, sla_horas')
    .eq('workspace_id', workspaceId)

  const hoy: ProcesoEtapaFoto[] = ((hoyRows ?? []) as Array<Record<string, unknown>>)
    .filter(r => Number(r.abiertos ?? 0) > 0)
    .map(r => ({
      etapaId: r.etapa_id as string,
      nombre: r.etapa_nombre as string,
      orden: numeroPorEtapa.get(r.etapa_id as string) ?? Number(r.etapa_orden ?? 0),
      abiertos: Number(r.abiertos ?? 0),
      vencidos: Number(r.vencidos ?? 0),
      slaHoras: r.sla_horas == null ? null : Number(r.sla_horas),
    }))
    .sort((a, b) => a.orden - b.orden)

  // `proceso_snapshots` es tabla nueva y todavia no esta en database.ts. Cast puntual,
  // mismo patron que el resto del repo. Deuda: regenerar tipos y re-agregar los aliases.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: snapRows } = await (supabase as any)
    .from('proceso_snapshots')
    .select('tomado_en, etapa_id, etapa_nombre, etapa_orden, etapa_numero, abiertos, vencidos')
    .eq('workspace_id', workspaceId)
    .order('tomado_en', { ascending: false })
    .limit(semanas * 40)

  // Agrupar por fecha de foto, de la mas reciente a la mas antigua.
  const porFecha = new Map<string, ProcesoEtapaFoto[]>()
  for (const r of ((snapRows ?? []) as Array<Record<string, unknown>>)) {
    const fecha = r.tomado_en as string
    if (!porFecha.has(fecha)) porFecha.set(fecha, [])
    porFecha.get(fecha)!.push({
      etapaId: r.etapa_id as string,
      nombre: r.etapa_nombre as string,
      // La foto congela el numero que la etapa tenia ese dia; si falta (fotos previas a
      // que existiera la columna), se cae al numero actual y por ultimo al orden.
      orden: Number(r.etapa_numero ?? numeroPorEtapa.get(r.etapa_id as string) ?? r.etapa_orden ?? 0),
      abiertos: Number(r.abiertos ?? 0),
      vencidos: Number(r.vencidos ?? 0),
      slaHoras: null,
    })
  }

  const fotos: ProcesoFoto[] = Array.from(porFecha.entries())
    .slice(0, semanas)
    .map(([fecha, etapas]) => ({
      fecha,
      etapas: etapas.filter(e => e.abiertos > 0).sort((a, b) => a.orden - b.orden),
    }))

  // Delta contra la foto anterior. Es el dato que Juan David mira: no cuantos hay,
  // sino si esa fila crecio o bajo. Si aun no hay foto previa, queda null (no cero:
  // "sin comparacion" y "sin cambio" no son lo mismo).
  //
  // La foto de HOY se excluye a proposito. La columna "Ahora" ya sale en vivo, asi que
  // comparar contra la foto de hoy daria cero en todas las etapas y se leeria como
  // "nada se movio esta semana", que es justo la lectura falsa que hay que evitar.
  const hoyISO = todayBogotaISO()
  const fotoPrevia = fotos.find(f => f.fecha < hoyISO) ?? null
  const previaPorEtapa = new Map((fotoPrevia?.etapas ?? []).map(e => [e.etapaId, e.abiertos]))
  const etapas: ProcesoEtapaConDelta[] = hoy.map(e => {
    const antes = fotoPrevia ? previaPorEtapa.get(e.etapaId) ?? 0 : undefined
    return { ...e, antes: antes ?? null, delta: antes == null ? null : e.abiertos - antes }
  })

  return {
    etapas,
    fotos,
    totalAbiertos: hoy.reduce((s, e) => s + e.abiertos, 0),
    fechaFotoPrevia: fotoPrevia?.fecha ?? null,
    // Cuantas etapas tienen SLA configurado. Si son pocas, el conteo de vencidos no
    // es representativo y la UI debe decirlo en vez de pintar un cero tranquilizador.
    etapasConSla: hoy.filter(e => e.slaHoras != null && e.slaHoras > 0).length,
    etapasTotales: hoy.length,
  }
}

// ── Proceso por seccional: dónde están los casos que necesitan cita ─────────
// Pedido por Juan David (SOENA): cuántos casos hay en cada una de las 4 ciudades que
// exigen cita previa en la DIAN, etapa por etapa, y cuántos en seccionales que no la
// exigen. Es lo que le permite decir "este mes solo pueden vender cuatro de Bogotá".
//
// El corte con/sin cita NO se hardcodea: sale del flag `cita` del catálogo
// SECCIONALES_DIAN. Si la DIAN cambia la exigencia, se actualiza ahí y esta vista sigue.

/** Clave de agrupación de una seccional: el canónico, o el texto crudo si no se reconoce. */
function claveSeccional(valor: string | null | undefined): string {
  const t = valor?.trim()
  if (!t) return ''
  return canonizarSeccional(t) ?? t
}

export async function getProcesoPorSeccional(): Promise<ProcesoSeccionalData | null> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!supabase || !workspaceId) return null

  // Hoy: en vivo desde `negocios`, para que la pantalla nunca muestre un dato rancio.
  const { data: negocios } = await supabase
    .from('negocios')
    .select('etapa_actual_id, metadata')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'abierto')

  const filas = (negocios ?? []) as unknown as Array<{ etapa_actual_id: string | null; metadata: Record<string, unknown> | null }>
  if (filas.length === 0) return null

  const { data: etapasRows } = await supabase
    .from('etapas_negocio')
    .select('id, nombre, numero, stage, config_extra')

  // `stage` es la fase del proceso y a la vez el area que la atiende (STAGE_TO_AREA).
  // Solo se acepta uno de los tres valores conocidos: cualquier otra cosa (o `cerrado`,
  // que no es un area) viaja como null y la tabla la deja sin color en vez de inventarle
  // uno. Sin dato NO es lo mismo que un dato cualquiera.
  const STAGES_VALIDOS = new Set(['venta', 'ejecucion', 'cobro'])
  const etapaInfo = new Map<string, { nombre: string; numero: number; stage: EtapaStage; slaHoras: number | null }>(
    ((etapasRows ?? []) as Array<{ id: string; nombre: string; numero: number | null; stage: string | null; config_extra: Record<string, unknown> | null }>)
      .map(e => [e.id, {
        nombre: e.nombre,
        numero: e.numero ?? 0,
        stage: (e.stage && STAGES_VALIDOS.has(e.stage) ? e.stage : null) as EtapaStage,
        slaHoras: (e.config_extra?.sla_horas as number | undefined) ?? null,
      }]),
  )

  // Foto anterior por (etapa, seccional). Se excluye la de hoy: comparar contra ella
  // daria cero en todo y se leeria como "no se movio nada".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: snapRows } = await (supabase as any)
    .from('proceso_snapshots')
    .select('tomado_en, etapa_id, seccional, abiertos, vencidos')
    .eq('workspace_id', workspaceId)
    .lt('tomado_en', todayBogotaISO())
    .order('tomado_en', { ascending: false })
    .limit(400)

  const snaps = (snapRows ?? []) as Array<Record<string, unknown>>
  const fechaFotoPrevia = (snaps[0]?.tomado_en as string | undefined) ?? null
  const antes = new Map<string, { abiertos: number; vencidos: number }>()
  if (fechaFotoPrevia) {
    for (const r of snaps) {
      if (r.tomado_en !== fechaFotoPrevia) continue
      // Las fotos viejas guardan el texto tal como estaba ese día, con sus variantes.
      // Se canonizan igual que el dato de hoy y se SUMAN cuando dos variantes colapsan
      // en la misma ciudad: si no, la comparación "hoy / semana pasada" restaría contra
      // una sola de las dos y mostraría una caída que nunca ocurrió.
      const k = `${r.etapa_id}::${claveSeccional(r.seccional as string | null)}`
      const acc = antes.get(k) ?? { abiertos: 0, vencidos: 0 }
      antes.set(k, {
        abiertos: acc.abiertos + Number(r.abiertos ?? 0),
        vencidos: acc.vencidos + Number(r.vencidos ?? 0),
      })
    }
  }

  // Conteo de hoy por (etapa, seccional). "Vencido" se calcula con el mismo criterio
  // que el historico: la vista de SLA agrega por etapa y aqui hace falta abrir por
  // seccional, asi que el dato de vencidos de HOY se toma del ultimo snapshot del dia
  // cuando existe; si no, queda en 0 y la columna lo refleja.
  const porEtapa = new Map<string, Map<string | null, { abiertos: number }>>()
  const seccionalesVistas = new Set<string>()
  let sinRegistrar = 0

  // Reprocesos abiertos por etapa y tipo. La marca vive en `negocios.metadata.reproceso`
  // (S1) y sus dos tipos coinciden con los dos cuadros de calidad del comite:
  // certificado UPME que salio mal, y devolucion que la DIAN rechazo.
  const reprocesosPorEtapa = new Map<string, { certificacionUpme: number; devolucionDian: number }>()
  const reprocesosTotal = { certificacionUpme: 0, devolucionDian: 0 }
  for (const n of filas) {
    if (!n.etapa_actual_id) continue
    const marca = n.metadata?.reproceso as { activo?: boolean; tipo?: string } | undefined
    if (marca?.activo !== true) continue
    const acc = reprocesosPorEtapa.get(n.etapa_actual_id) ?? { certificacionUpme: 0, devolucionDian: 0 }
    if (marca.tipo === 'certificacion_upme') { acc.certificacionUpme++; reprocesosTotal.certificacionUpme++ }
    else if (marca.tipo === 'devolucion_dian') { acc.devolucionDian++; reprocesosTotal.devolucionDian++ }
    reprocesosPorEtapa.set(n.etapa_actual_id, acc)
  }

  for (const n of filas) {
    if (!n.etapa_actual_id) continue
    // Se agrupa por el nombre CANÓNICO, no por el texto guardado. El dato quedó
    // canonizado en origen (ver `seccional-negocio.ts`), pero la vista lo vuelve a
    // canonizar al leer: es lo que impide que un cargue nuevo, un script viejo o un
    // registro histórico partan otra vez una ciudad en dos columnas.
    const crudo = (n.metadata?.seccional as string | undefined)?.trim() || null
    const sec = crudo ? (canonizarSeccional(crudo) ?? crudo) : null
    if (sec === null) sinRegistrar++
    else seccionalesVistas.add(sec)
    const m = porEtapa.get(n.etapa_actual_id) ?? new Map<string | null, { abiertos: number }>()
    const prev = m.get(sec)?.abiertos ?? 0
    m.set(sec, { abiertos: prev + 1 })
    porEtapa.set(n.etapa_actual_id, m)
  }

  // Vencidos de hoy: del snapshot de hoy, que ya los calculo con horas habiles.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: hoyRows } = await (supabase as any)
    .from('proceso_snapshots')
    .select('etapa_id, seccional, vencidos')
    .eq('workspace_id', workspaceId)
    .eq('tomado_en', todayBogotaISO())

  const vencidosHoy = new Map<string, number>()
  for (const r of ((hoyRows ?? []) as Array<Record<string, unknown>>)) {
    const k = `${r.etapa_id}::${claveSeccional(r.seccional as string | null)}`
    vencidosHoy.set(k, (vencidosHoy.get(k) ?? 0) + Number(r.vencidos ?? 0))
  }

  const etapas: ProcesoSeccionalEtapa[] = Array.from(porEtapa.entries())
    .map(([etapaId, m]) => {
      const info = etapaInfo.get(etapaId)
      const celdas = Array.from(m.entries()).map(([seccional, v]) => {
        const k = `${etapaId}::${seccional ?? ''}`
        const prev = antes.get(k)
        return {
          seccional,
          abiertos: v.abiertos,
          vencidos: vencidosHoy.get(k) ?? 0,
          abiertosAntes: fechaFotoPrevia ? (prev?.abiertos ?? 0) : null,
          vencidosAntes: fechaFotoPrevia ? (prev?.vencidos ?? 0) : null,
        }
      })
      // El total de la etapa es la suma de sus seccionales: asi la vista contraida y la
      // expandida no pueden contar distinto, por construccion.
      const total = celdas.reduce(
        (acc, c) => ({
          seccional: null,
          abiertos: acc.abiertos + c.abiertos,
          vencidos: acc.vencidos + c.vencidos,
          abiertosAntes: c.abiertosAntes === null ? acc.abiertosAntes : (acc.abiertosAntes ?? 0) + c.abiertosAntes,
          vencidosAntes: c.vencidosAntes === null ? acc.vencidosAntes : (acc.vencidosAntes ?? 0) + c.vencidosAntes,
        }),
        { seccional: null, abiertos: 0, vencidos: 0, abiertosAntes: null as number | null, vencidosAntes: null as number | null },
      )
      return {
        etapaId,
        numero: info?.numero ?? 0,
        nombre: info?.nombre ?? '\u2014',
        stage: info?.stage ?? null,
        celdas,
        total,
        reprocesos: reprocesosPorEtapa.get(etapaId) ?? { certificacionUpme: 0, devolucionDian: 0 },
        slaHoras: info?.slaHoras ?? null,
      }
    })
    .sort((a, b) => a.numero - b.numero)

  const norm = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const exigeCita = new Map<string, boolean>()
  for (const sc of SECCIONALES_DIAN) {
    exigeCita.set(norm(sc.label), sc.cita)
    if (sc.ciudad) exigeCita.set(norm(sc.ciudad), sc.cita)
  }

  const conCita: string[] = []
  const sinCita: string[] = []
  for (const sc of Array.from(seccionalesVistas).sort()) {
    if (exigeCita.get(norm(sc)) === true) conCita.push(sc)
    else sinCita.push(sc)
  }

  const etapasConSla = etapas.filter(e => (e.slaHoras ?? 0) > 0).length

  return {
    etapas,
    conCita,
    sinCita,
    sinRegistrar,
    total: filas.length,
    fechaFotoPrevia,
    reprocesosTotal,
    etapasConSla,
    etapasTotales: etapas.length,
  }
}

// ── Drill-down: qué casos hay detrás de un número de la tabla de proceso ────
// Al hacer clic en una celda (etapa + seccional, atrasados o todos) se abre la lista
// concreta. Sin esto el tablero dice "17 en Precobro" y hay que ir a buscarlos a mano.
export interface CasoEnEtapa {
  id: string
  codigo: string | null
  nombre: string
  seccional: string | null
  responsable: string | null
  horasEnEtapa: number | null
  vencido: boolean
  reproceso: string | null
  /** Días desde la última actividad registrada en el negocio. `null` = nunca se tocó. */
  diasInactivo: number | null
}

export async function getCasosDeEtapa(input: {
  etapaId: string
  /**
   * `undefined` = todas las seccionales. `null` = solo los que no la tienen registrada.
   * Un ARREGLO abre las columnas que agrupan varias: "Sin cita" son las catorce
   * seccionales que no exigen cita previa, y sin esto era la única celda del tablero
   * que mostraba un número sin dejar ver de quiénes se trataba.
   */
  seccional?: string | string[] | null
  soloVencidos: boolean
  /** Solo los que tienen un reproceso abierto. */
  soloReproceso?: boolean
}): Promise<CasoEnEtapa[]> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!supabase || !workspaceId) return []

  const { data: negocios } = await supabase
    .from('negocios')
    .select('id, codigo, nombre, metadata, etapa_cambiada_at, responsable_id, created_at')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'abierto')
    .eq('etapa_actual_id', input.etapaId)

  const filas = (negocios ?? []) as unknown as Array<{
    id: string
    codigo: string | null
    nombre: string | null
    metadata: Record<string, unknown> | null
    etapa_cambiada_at: string | null
    responsable_id: string | null
    created_at: string | null
  }>
  if (filas.length === 0) return []

  // El tiempo máximo y el cálculo de atraso son los MISMOS que usa la tabla: horas
  // hábiles contra el sla de la etapa. Si difirieran, el drill-down mostraría una
  // lista que no cuadra con el número en el que el usuario hizo clic.
  const { data: etapa } = await supabase
    .from('etapas_negocio')
    .select('config_extra')
    .eq('id', input.etapaId)
    .single()
  const slaHoras = ((etapa as { config_extra?: { sla_horas?: number } } | null)?.config_extra?.sla_horas) ?? null

  const staffIds = Array.from(new Set(filas.map(f => f.responsable_id).filter((v): v is string => !!v)))
  const nombrePorStaff = new Map<string, string>()
  if (staffIds.length > 0) {
    const { data: staff } = await supabase.from('staff').select('id, full_name').in('id', staffIds)
    for (const s of ((staff ?? []) as Array<{ id: string; full_name: string | null }>)) {
      nombrePorStaff.set(s.id, s.full_name ?? '—')
    }
  }

  let horasPorNegocio = new Map<string, number>()
  if (slaHoras && slaHoras > 0) {
    // Se pide el cálculo a la misma función SQL que alimenta la vista de SLA, en vez de
    // replicarlo en TypeScript: ya hay dos implementaciones del algoritmo y no conviene
    // una tercera.
    const ids = filas.map(f => f.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: horas } = await (supabase as any).rpc('horas_habiles_negocios', { p_ids: ids })
    if (Array.isArray(horas)) {
      horasPorNegocio = new Map(
        (horas as Array<{ negocio_id: string; horas: number }>).map(h => [h.negocio_id, Number(h.horas)]),
      )
    }
  }

  // Dias sin que nadie toque el caso. Sale del timeline del negocio (`activity_log`),
  // que es lo que el equipo ve cuando lo abre: comentarios y cambios registrados.
  // Si el negocio no tiene ninguna entrada todavia, se cuenta desde que se creo.
  const ultimaActividad = new Map<string, string>()
  {
    const ids = filas.map(f => f.id)
    const { data: acts } = await supabase
      .from('activity_log')
      .select('entidad_id, created_at')
      .eq('entidad_tipo', 'negocio')
      .in('entidad_id', ids)
      .order('created_at', { ascending: false })
    for (const a of ((acts ?? []) as Array<{ entidad_id: string; created_at: string }>)) {
      if (!ultimaActividad.has(a.entidad_id)) ultimaActividad.set(a.entidad_id, a.created_at)
    }
  }
  const ahora = Date.now()
  const diasDesde = (iso: string | null | undefined): number | null => {
    if (!iso) return null
    const t = new Date(iso).getTime()
    if (Number.isNaN(t)) return null
    return Math.floor((ahora - t) / 86_400_000)
  }

  const casos: CasoEnEtapa[] = filas.map(f => {
    const h = horasPorNegocio.get(f.id) ?? null
    const marca = f.metadata?.reproceso as { activo?: boolean; tipo?: string } | undefined
    return {
      id: f.id,
      codigo: f.codigo,
      nombre: f.nombre ?? '—',
      // Canonizada, igual que en la tabla: el filtro de abajo compara contra el nombre
      // de la columna en la que se hizo clic, y ese nombre es el canónico.
      seccional: (() => {
        const c = claveSeccional(f.metadata?.seccional as string | undefined)
        return c === '' ? null : c
      })(),
      responsable: f.responsable_id ? (nombrePorStaff.get(f.responsable_id) ?? null) : null,
      horasEnEtapa: h,
      vencido: Boolean(slaHoras && slaHoras > 0 && h !== null && h > slaHoras),
      reproceso: marca?.activo === true ? (marca.tipo ?? null) : null,
      diasInactivo: diasDesde(ultimaActividad.get(f.id) ?? f.created_at),
    }
  })

  const enSeccional = (c: CasoEnEtapa): boolean => {
    if (input.seccional === undefined) return true
    if (Array.isArray(input.seccional)) return c.seccional !== null && input.seccional.includes(c.seccional)
    return c.seccional === input.seccional
  }

  return casos
    .filter(enSeccional)
    .filter(c => (input.soloVencidos ? c.vencido : true))
    .filter(c => (input.soloReproceso ? c.reproceso !== null : true))
    // Lo mas atascado primero: primero por tiempo en la etapa, y a igualdad, por
    // dias sin que nadie lo toque.
    .sort((a, b) => (b.horasEnEtapa ?? 0) - (a.horasEnEtapa ?? 0) || (b.diasInactivo ?? 0) - (a.diasInactivo ?? 0))
}
