'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'

// ── Types ─────────────────────────────────────────────

export interface NumerosData {
  // P1: Cuanta plata tengo
  saldoCaja: number
  saldoEsReal: boolean          // true = from saldos_banco, false = calculated
  recaudoMes: number
  metaRecaudo: number | null
  recaudoMesAnterior: number

  // P2: Estoy ganando
  ingresosMes: number            // cobros del mes
  gastosMes: number              // gastos del mes
  utilidad: number               // ingresos - gastos
  ingresosMesAnterior: number
  gastosMesAnterior: number

  // P3: Cuanto me deben
  carteraPendiente: number       // facturas - cobros
  totalFacturado: number
  totalCobrado: number
  carteraMesAnterior: number

  // P4: Cuanto necesito vender
  ventasMes: number              // facturas emitidas del mes
  metaVentas: number | null
  costosFijosMes: number
  margenContribucion: number     // avg from closed projects
  puntoEquilibrio: number

  // P5: Cuanto aguanto
  runwayMeses: number
  gastoPromedioMensual: number

  // Semáforo
  semaforo: SemaforoData

  // Franja conciliación
  conciliacion: ConciliacionData

  // Meta info
  mesRef: string                 // YYYY-MM
  diaActual: number
  diasDelMes: number
  nombreUsuario: string
}

export interface SemaforoData {
  capa1Score: number            // 0-100
  capa1Estado: 'red' | 'yellow' | 'green'
  capa1Pendientes: SemaforoPendiente[]
  capa2Estado: 'red' | 'yellow' | 'green' | null  // null = not evaluated
  capa2Razon: string | null
  estadoFinal: 'red' | 'yellow' | 'green'
  mensaje: string
}

export interface SemaforoPendiente {
  label: string
  done: boolean
  action?: string               // link/CTA
}

export interface ConciliacionData {
  saldoReal: number | null
  saldoTeorico: number
  diferencia: number
  diasDesdeUltimo: number | null
  streakSemanas: number
  streakRecord: number
  streakMilestone: string | null  // 🥉🥈🥇🏆
  estado: 1 | 2 | 3 | 4         // 4 visual states from spec
}

// ── getNumeros ────────────────────────────────────────

export async function getNumeros(mesRef?: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const now = new Date()
  const mes = mesRef ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [yyyy, mm] = mes.split('-').map(Number)
  const mesStart = `${mes}-01`
  const mesEnd = new Date(yyyy, mm, 1).toISOString().split('T')[0]
  const diaActual = (mes === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`) ? now.getDate() : new Date(yyyy, mm, 0).getDate()
  const diasDelMes = new Date(yyyy, mm, 0).getDate()

  // Previous month
  const prevDate = new Date(yyyy, mm - 2, 1)
  const prevMes = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`
  const prevStart = `${prevMes}-01`
  const prevEnd = mesStart

  // 3 months ago for averages
  const tresMesesAtras = new Date(yyyy, mm - 4, 1).toISOString().split('T')[0]

  // ── Parallel fetches ─────────────────────────────
  const [
    saldoBancoRes,
    cobrosRes,
    cobrosPrevRes,
    gastosRes,
    gastosPrevRes,
    gastos3mRes,
    facturasRes,
    facturasTotalRes,
    cobrosTotalRes,
    configMetasRes,
    gastosFijosRes,
    proyectosCerradosRes,
    streakRes,
    profileRes,
    // Semáforo indicators
    empresasRes,
    oportunidadesRes,
    horasRecientesRes,
    gastosFijosBorradoresRes,
  ] = await Promise.all([
    // Latest bank balance
    supabase
      .from('saldos_banco')
      .select('saldo_real, saldo_teorico, diferencia, fecha')
      .eq('workspace_id', workspaceId)
      .order('fecha', { ascending: false })
      .limit(1),

    // Cobros del mes
    supabase
      .from('cobros')
      .select('monto')
      .eq('workspace_id', workspaceId)
      .gte('fecha', mesStart)
      .lt('fecha', mesEnd),

    // Cobros mes anterior
    supabase
      .from('cobros')
      .select('monto')
      .eq('workspace_id', workspaceId)
      .gte('fecha', prevStart)
      .lt('fecha', prevEnd),

    // Gastos del mes
    supabase
      .from('gastos')
      .select('monto')
      .eq('workspace_id', workspaceId)
      .gte('fecha', mesStart)
      .lt('fecha', mesEnd),

    // Gastos mes anterior
    supabase
      .from('gastos')
      .select('monto')
      .eq('workspace_id', workspaceId)
      .gte('fecha', prevStart)
      .lt('fecha', prevEnd),

    // Gastos últimos 3 meses (for runway avg)
    supabase
      .from('gastos')
      .select('monto, fecha')
      .eq('workspace_id', workspaceId)
      .gte('fecha', tresMesesAtras)
      .lt('fecha', mesEnd),

    // Facturas emitidas del mes (ventas)
    supabase
      .from('facturas')
      .select('monto, fecha_emision')
      .eq('workspace_id', workspaceId)
      .gte('fecha_emision', mesStart)
      .lt('fecha_emision', mesEnd),

    // All facturas (for cartera)
    supabase
      .from('facturas')
      .select('id, monto, fecha_emision')
      .eq('workspace_id', workspaceId),

    // All cobros (for cartera)
    supabase
      .from('cobros')
      .select('monto, factura_id')
      .eq('workspace_id', workspaceId),

    // Metas del mes
    supabase
      .from('config_metas')
      .select('meta_ventas_mensual, meta_recaudo_mensual')
      .eq('workspace_id', workspaceId)
      .eq('mes', mesStart)
      .maybeSingle(),

    // Gastos fijos configurados
    supabase
      .from('gastos_fijos_config')
      .select('monto_referencia')
      .eq('workspace_id', workspaceId)
      .eq('activo', true),

    // Proyectos cerrados (for margen contribution) — use view
    supabase
      .from('v_proyecto_financiero')
      .select('presupuesto_total, costo_acumulado')
      .eq('estado', 'cerrado'),

    // Streak
    supabase
      .from('streaks')
      .select('semanas_actuales, semanas_record, ultima_actualizacion')
      .eq('workspace_id', workspaceId)
      .eq('tipo', 'conciliacion')
      .maybeSingle(),

    // Profile name
    supabase
      .from('profiles')
      .select('full_name')
      .eq('workspace_id', workspaceId)
      .limit(1)
      .single(),

    // Semáforo: empresas with fiscal data
    supabase
      .from('empresas')
      .select('id, numero_documento, regimen_tributario')
      .eq('workspace_id', workspaceId),

    // Semáforo: oportunidades activas (recent activity)
    supabase
      .from('oportunidades')
      .select('id, updated_at')
      .eq('workspace_id', workspaceId)
      .in('etapa', ['contacto_inicial', 'propuesta', 'negociacion']),

    // Semáforo: horas registradas recientes
    supabase
      .from('horas')
      .select('id')
      .eq('workspace_id', workspaceId)
      .gte('fecha', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      .limit(1),

    // Semáforo: gastos fijos borradores del mes
    supabase
      .from('gastos_fijos_borradores')
      .select('id, confirmado')
      .eq('workspace_id', workspaceId)
      .eq('periodo', mesStart),
  ])

  // ── Calculate values ─────────────────────────────

  // Bank balance
  const ultimoSaldo = saldoBancoRes.data?.[0] ?? null
  const saldoEsReal = !!ultimoSaldo

  // Cobros / Ingresos
  const recaudoMes = (cobrosRes.data ?? []).reduce((s, c) => s + Number(c.monto), 0)
  const recaudoMesAnterior = (cobrosPrevRes.data ?? []).reduce((s, c) => s + Number(c.monto), 0)
  const ingresosMes = recaudoMes
  const ingresosMesAnterior = recaudoMesAnterior

  // Gastos
  const gastosMes = (gastosRes.data ?? []).reduce((s, g) => s + Number(g.monto), 0)
  const gastosMesAnterior = (gastosPrevRes.data ?? []).reduce((s, g) => s + Number(g.monto), 0)

  // Gastos avg (3 months)
  const gastos3m = gastos3mRes.data ?? []
  const monthsMap = new Map<string, number>()
  gastos3m.forEach(g => {
    const m = g.fecha.substring(0, 7)
    monthsMap.set(m, (monthsMap.get(m) ?? 0) + Number(g.monto))
  })
  const numMonths = Math.max(monthsMap.size, 1)
  const gastoPromedioMensual = [...monthsMap.values()].reduce((s, v) => s + v, 0) / numMonths

  // Saldo caja
  let saldoTeorico = recaudoMes - gastosMes // simplified
  if (ultimoSaldo) {
    // Calculate theoretical from last real balance
    const lastBalanceDate = ultimoSaldo.fecha ?? new Date().toISOString()
    const lastDateStr = lastBalanceDate.split('T')[0]
    const cobrosDesde = await supabase
      .from('cobros')
      .select('monto')
      .eq('workspace_id', workspaceId)
      .gt('fecha', lastDateStr)
    const gastosDesde = await supabase
      .from('gastos')
      .select('monto')
      .eq('workspace_id', workspaceId)
      .gt('fecha', lastDateStr)

    const cobrosPostSaldo = (cobrosDesde.data ?? []).reduce((s, c) => s + Number(c.monto), 0)
    const gastosPostSaldo = (gastosDesde.data ?? []).reduce((s, c) => s + Number(c.monto), 0)
    saldoTeorico = Number(ultimoSaldo.saldo_real) + cobrosPostSaldo - gastosPostSaldo
  }

  const saldoCaja = ultimoSaldo ? Number(ultimoSaldo.saldo_real) : saldoTeorico

  // Cartera
  const allFacturas = facturasTotalRes.data ?? []
  const allCobros = cobrosTotalRes.data ?? []
  const cobrosPorFactura = new Map<string, number>()
  allCobros.forEach(c => {
    const fid = c.factura_id
    cobrosPorFactura.set(fid, (cobrosPorFactura.get(fid) ?? 0) + Number(c.monto))
  })
  const totalFacturado = allFacturas.reduce((s, f) => s + Number(f.monto), 0)
  const totalCobrado = allCobros.reduce((s, c) => s + Number(c.monto), 0)
  const carteraPendiente = totalFacturado - totalCobrado

  // Cartera vencida (>30 days)
  const today = new Date()
  let carteraVencida = 0
  allFacturas.forEach(f => {
    const cobradoFactura = cobrosPorFactura.get(f.id) ?? 0
    const saldoF = Number(f.monto) - cobradoFactura
    if (saldoF > 0) {
      const dias = Math.floor((today.getTime() - new Date(f.fecha_emision).getTime()) / (86400000))
      if (dias > 30) carteraVencida += saldoF
    }
  })

  const carteraMesAnterior = ingresosMesAnterior > 0 ? carteraPendiente * 0.9 : 0 // approximate

  // Ventas (facturas emitidas del mes)
  const ventasMes = (facturasRes.data ?? []).reduce((s, f) => s + Number(f.monto), 0)

  // Metas
  let metaVentas = configMetasRes.data?.meta_ventas_mensual ? Number(configMetasRes.data.meta_ventas_mensual) : null
  let metaRecaudo = configMetasRes.data?.meta_recaudo_mensual ? Number(configMetasRes.data.meta_recaudo_mensual) : null

  // If no meta for this month, try to inherit
  if (!metaVentas) {
    const { data: lastMeta } = await supabase
      .from('config_metas')
      .select('meta_ventas_mensual, meta_recaudo_mensual')
      .eq('workspace_id', workspaceId)
      .lt('mes', mesStart)
      .order('mes', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (lastMeta) {
      metaVentas = lastMeta.meta_ventas_mensual ? Number(lastMeta.meta_ventas_mensual) : null
      metaRecaudo = lastMeta.meta_recaudo_mensual ? Number(lastMeta.meta_recaudo_mensual) : null
    }
  }

  // Fallback: check v1 monthly_targets table
  if (!metaVentas) {
    const { data: v1Meta } = await supabase
      .from('monthly_targets')
      .select('sales_target, collection_target')
      .eq('workspace_id', workspaceId)
      .eq('year', yyyy)
      .eq('month', mm)
      .maybeSingle()
    if (v1Meta) {
      metaVentas = v1Meta.sales_target ? Number(v1Meta.sales_target) : null
      metaRecaudo = v1Meta.collection_target ? Number(v1Meta.collection_target) : null
    }
  }

  // Gastos fijos
  const costosFijosMes = (gastosFijosRes.data ?? []).reduce((s, g) => s + Number(g.monto_referencia), 0)

  // Margen contribución (from closed projects)
  const proyectosCerrados = proyectosCerradosRes.data ?? []
  let margenContribucion = 0.3 // default 30%
  if (proyectosCerrados.length > 0) {
    const margenes = proyectosCerrados
      .filter(p => Number(p.presupuesto_total) > 0)
      .map(p => 1 - (Number(p.costo_acumulado) / Number(p.presupuesto_total)))
    if (margenes.length > 0) {
      margenContribucion = margenes.reduce((s, m) => s + m, 0) / margenes.length
    }
  }

  // PE
  const puntoEquilibrio = margenContribucion > 0 ? costosFijosMes / margenContribucion : costosFijosMes

  // Runway
  const runwayMeses = gastoPromedioMensual > 0 ? saldoCaja / gastoPromedioMensual : 99

  // ── Conciliación ─────────────────────────────────
  const streakData = streakRes.data
  const diasDesdeUltimo = ultimoSaldo?.fecha
    ? Math.floor((today.getTime() - new Date(ultimoSaldo.fecha).getTime()) / 86400000)
    : null

  const streakSemanas = streakData?.semanas_actuales ?? 0
  const streakRecord = streakData?.semanas_record ?? 0
  let streakMilestone: string | null = null
  if (streakSemanas >= 52) streakMilestone = '🏆'
  else if (streakSemanas >= 26) streakMilestone = '🥇'
  else if (streakSemanas >= 12) streakMilestone = '🥈'
  else if (streakSemanas >= 4) streakMilestone = '🥉'

  const diferencia = ultimoSaldo ? Number(ultimoSaldo.diferencia) : 0
  const toleranciaAbs = 50000
  const toleranciaPct = saldoCaja > 0 ? saldoCaja * 0.02 : toleranciaAbs
  const tolerancia = Math.max(toleranciaAbs, toleranciaPct)

  let conciliacionEstado: 1 | 2 | 3 | 4 = 1
  if (!diasDesdeUltimo || diasDesdeUltimo > 7) {
    conciliacionEstado = 4
  } else if (Math.abs(diferencia) > tolerancia) {
    conciliacionEstado = 3
  } else if (diasDesdeUltimo >= 4) {
    conciliacionEstado = 2
  }

  // ── Semáforo ─────────────────────────────────────
  const semaforo = calcularSemaforo({
    gastosFijosCount: gastosFijosRes.data?.length ?? 0,
    metaVentas,
    empresas: empresasRes.data ?? [],
    diasDesdeUltimoSaldo: diasDesdeUltimo,
    oportunidades: oportunidadesRes.data ?? [],
    gastosFijosBorradores: gastosFijosBorradoresRes.data ?? [],
    horasRecientes: (horasRecientesRes.data?.length ?? 0) > 0,
    diferencia,
    tolerancia,
    // Capa 2
    runwayMeses,
    ventasMes,
    puntoEquilibrio,
    carteraVencida,
    carteraPendiente,
  })

  const conciliacion: ConciliacionData = {
    saldoReal: ultimoSaldo ? Number(ultimoSaldo.saldo_real) : null,
    saldoTeorico,
    diferencia,
    diasDesdeUltimo,
    streakSemanas,
    streakRecord,
    streakMilestone,
    estado: conciliacionEstado,
  }

  const nombre = profileRes.data?.full_name ?? 'Usuario'

  return {
    saldoCaja,
    saldoEsReal,
    recaudoMes,
    metaRecaudo,
    recaudoMesAnterior,
    ingresosMes,
    gastosMes,
    utilidad: ingresosMes - gastosMes,
    ingresosMesAnterior,
    gastosMesAnterior,
    carteraPendiente,
    totalFacturado,
    totalCobrado,
    carteraMesAnterior,
    ventasMes,
    metaVentas,
    costosFijosMes,
    margenContribucion,
    puntoEquilibrio,
    runwayMeses,
    gastoPromedioMensual,
    semaforo,
    conciliacion,
    mesRef: mes,
    diaActual,
    diasDelMes,
    nombreUsuario: nombre.split(' ')[0],
  } satisfies NumerosData
}

// ── Semáforo calculation ──────────────────────────────

interface SemaforoInput {
  gastosFijosCount: number
  metaVentas: number | null
  empresas: { id: string; numero_documento: string | null; regimen_tributario: string | null }[]
  diasDesdeUltimoSaldo: number | null
  oportunidades: { id: string; updated_at: string | null }[]
  gastosFijosBorradores: { id: string; confirmado: boolean | null }[]
  horasRecientes: boolean
  diferencia: number
  tolerancia: number
  runwayMeses: number
  ventasMes: number
  puntoEquilibrio: number
  carteraVencida: number
  carteraPendiente: number
}

function calcularSemaforo(input: SemaforoInput): SemaforoData {
  const pendientes: SemaforoPendiente[] = []

  // ── Capa 1: Completitud ──────────────────────────

  // Score weights: critico=3, alto=2, medio=1
  let totalWeight = 0
  let greenWeight = 0

  // 1. Gastos fijos configurados (Crítico, peso 3)
  const gfScore = input.gastosFijosCount >= 3 ? 'green' : input.gastosFijosCount >= 1 ? 'yellow' : 'red'
  totalWeight += 3
  if (gfScore === 'green') greenWeight += 3
  else if (gfScore === 'yellow') greenWeight += 1.5
  pendientes.push({
    label: 'Gastos fijos configurados',
    done: gfScore === 'green',
    action: gfScore !== 'green' ? '/config' : undefined,
  })

  // 2. Meta ventas definida (Crítico, peso 3)
  const metaScore = input.metaVentas && input.metaVentas > 0 ? 'green' : 'red'
  totalWeight += 3
  if (metaScore === 'green') greenWeight += 3
  pendientes.push({
    label: 'Meta de ventas definida',
    done: metaScore === 'green',
    action: metaScore !== 'green' ? '/config' : undefined,
  })

  // 3. Datos fiscales clientes activos (Alto, peso 2)
  const empresasTotal = input.empresas.length
  const empresasCompletas = input.empresas.filter(e => e.numero_documento && e.regimen_tributario).length
  const pctFiscal = empresasTotal > 0 ? empresasCompletas / empresasTotal : 1
  const fiscalScore = pctFiscal >= 1 ? 'green' : pctFiscal >= 0.7 ? 'yellow' : 'red'
  totalWeight += 2
  if (fiscalScore === 'green') greenWeight += 2
  else if (fiscalScore === 'yellow') greenWeight += 1
  if (fiscalScore !== 'green' && empresasTotal > 0) {
    pendientes.push({
      label: `Datos fiscales de ${empresasTotal - empresasCompletas} empresa${empresasTotal - empresasCompletas > 1 ? 's' : ''}`,
      done: false,
      action: '/directorio',
    })
  } else {
    pendientes.push({ label: 'Datos fiscales clientes', done: true })
  }

  // 4. Saldo bancario actualizado (Alto, peso 2)
  const saldoScore = input.diasDesdeUltimoSaldo === null
    ? 'red'
    : input.diasDesdeUltimoSaldo < 4 ? 'green' : input.diasDesdeUltimoSaldo <= 7 ? 'yellow' : 'red'
  totalWeight += 2
  if (saldoScore === 'green') greenWeight += 2
  else if (saldoScore === 'yellow') greenWeight += 1
  pendientes.push({
    label: 'Saldo bancario actualizado',
    done: saldoScore === 'green',
  })

  // 5. Oportunidades actualizadas (Medio, peso 1)
  const now = Date.now()
  const oppsActivas = input.oportunidades
  const oppsRecientes = oppsActivas.filter(o => o.updated_at && (now - new Date(o.updated_at).getTime()) < 14 * 86400000)
  const pctOpps = oppsActivas.length > 0 ? oppsRecientes.length / oppsActivas.length : 1
  const oppsScore = pctOpps >= 1 ? 'green' : pctOpps >= 0.7 ? 'yellow' : 'red'
  totalWeight += 1
  if (oppsScore === 'green') greenWeight += 1
  else if (oppsScore === 'yellow') greenWeight += 0.5
  if (oppsScore !== 'green' && oppsActivas.length > 0) {
    pendientes.push({
      label: 'Oportunidades actualizadas',
      done: false,
      action: '/pipeline',
    })
  } else {
    pendientes.push({ label: 'Oportunidades actualizadas', done: oppsActivas.length === 0 || oppsScore === 'green' })
  }

  // 6. Gastos fijos mes confirmados (Medio, peso 1)
  const borradores = input.gastosFijosBorradores
  const confirmados = borradores.filter(b => b.confirmado)
  const pctConfirmados = borradores.length > 0 ? confirmados.length / borradores.length : 1
  const borrScore = pctConfirmados >= 1 ? 'green' : pctConfirmados >= 0.5 ? 'yellow' : 'red'
  totalWeight += 1
  if (borrScore === 'green') greenWeight += 1
  else if (borrScore === 'yellow') greenWeight += 0.5
  if (borrScore !== 'green' && borradores.length > 0) {
    pendientes.push({
      label: `Confirmar ${borradores.length - confirmados.length} gasto${borradores.length - confirmados.length > 1 ? 's' : ''} fijo${borradores.length - confirmados.length > 1 ? 's' : ''} del mes`,
      done: false,
    })
  } else {
    pendientes.push({ label: 'Gastos fijos del mes confirmados', done: true })
  }

  // 7. Proyectos con horas al día (Bajo, peso 1)
  totalWeight += 1
  if (input.horasRecientes) greenWeight += 1
  pendientes.push({
    label: 'Horas de proyectos al dia',
    done: input.horasRecientes,
    action: !input.horasRecientes ? '/proyectos' : undefined,
  })

  // 8. Diferencia conciliación (Medio, peso 1)
  const diffScore = input.diasDesdeUltimoSaldo === null
    ? 'red'
    : Math.abs(input.diferencia) <= input.tolerancia * 0.02 ? 'green'
    : Math.abs(input.diferencia) <= input.tolerancia * 0.1 ? 'yellow'
    : 'red'
  totalWeight += 1
  if (diffScore === 'green') greenWeight += 1
  else if (diffScore === 'yellow') greenWeight += 0.5
  pendientes.push({
    label: 'Conciliacion bancaria al dia',
    done: diffScore === 'green' || saldoScore === 'green',
  })

  const capa1Score = Math.round((greenWeight / totalWeight) * 100)
  const capa1Estado: 'red' | 'yellow' | 'green' =
    capa1Score >= 80 ? 'green' : capa1Score >= 50 ? 'yellow' : 'red'

  // ── Capa 2: Salud financiera (solo si Capa 1 ≥ 80%) ──
  let capa2Estado: 'red' | 'yellow' | 'green' | null = null
  let capa2Razon: string | null = null

  if (capa1Estado === 'green') {
    // Runway
    const runwayColor = input.runwayMeses > 6 ? 'green' : input.runwayMeses >= 3 ? 'yellow' : 'red'

    // Facturación vs PE
    const factVsPe = input.puntoEquilibrio > 0 ? input.ventasMes / input.puntoEquilibrio : 1
    const factColor = factVsPe > 1.2 ? 'green' : factVsPe >= 1 ? 'yellow' : 'red'

    // Cartera vencida
    const pctCarteraVencida = input.carteraPendiente > 0
      ? input.carteraVencida / input.carteraPendiente
      : 0
    const carteraColor = pctCarteraVencida < 0.2 ? 'green' : pctCarteraVencida <= 0.4 ? 'yellow' : 'red'

    // Worst of three
    const colors = [runwayColor, factColor, carteraColor]
    if (colors.includes('red')) {
      capa2Estado = 'red'
      if (runwayColor === 'red') capa2Razon = `Runway: ${input.runwayMeses.toFixed(1)} meses — acelera cobros o reduce gastos`
      else if (factColor === 'red') capa2Razon = `Facturacion bajo PE — faltan $${Math.round(input.puntoEquilibrio - input.ventasMes).toLocaleString('es-CO')}`
      else capa2Razon = `Cartera vencida: ${Math.round(pctCarteraVencida * 100)}% — revisa cobros pendientes`
    } else if (colors.includes('yellow')) {
      capa2Estado = 'yellow'
      if (runwayColor === 'yellow') capa2Razon = `Runway: ${input.runwayMeses.toFixed(1)} meses`
      else if (factColor === 'yellow') capa2Razon = `Facturacion entre PE y meta`
      else capa2Razon = `Cartera vencida: ${Math.round(pctCarteraVencida * 100)}% — revisa cobros pendientes`
    } else {
      capa2Estado = 'green'
    }
  }

  // Final state
  let estadoFinal: 'red' | 'yellow' | 'green' = capa1Estado
  if (capa1Estado === 'green' && capa2Estado) {
    estadoFinal = capa2Estado
  }

  // Messages
  let mensaje = ''
  if (capa1Estado === 'red') {
    mensaje = 'Tus numeros no son confiables aun'
  } else if (capa1Estado === 'yellow') {
    const pendientesCount = pendientes.filter(p => !p.done).length
    mensaje = `Casi listo — ${pendientesCount} pendiente${pendientesCount > 1 ? 's' : ''} para lectura completa`
  } else if (capa2Estado === 'green') {
    mensaje = 'Datos completos. Tu negocio esta sano.'
  } else if (capa2Estado === 'yellow') {
    mensaje = 'Datos completos. Hay temas que atender.'
  } else if (capa2Estado === 'red') {
    mensaje = 'Datos completos. Tu negocio necesita accion inmediata.'
  }

  return {
    capa1Score,
    capa1Estado,
    capa1Pendientes: pendientes,
    capa2Estado,
    capa2Razon,
    estadoFinal,
    mensaje,
  }
}

// ── Actualizar saldo bancario ─────────────────────────

export async function actualizarSaldo(saldoReal: number, nota?: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Calculate theoretical balance
  const { data: ultimoSaldo } = await supabase
    .from('saldos_banco')
    .select('saldo_real, fecha')
    .eq('workspace_id', workspaceId)
    .order('fecha', { ascending: false })
    .limit(1)
    .maybeSingle()

  let saldoTeorico = 0
  if (ultimoSaldo) {
    const lastDate = (ultimoSaldo.fecha ?? new Date().toISOString()).split('T')[0]
    const [cobrosDesde, gastosDesde] = await Promise.all([
      supabase.from('cobros').select('monto').eq('workspace_id', workspaceId).gt('fecha', lastDate),
      supabase.from('gastos').select('monto').eq('workspace_id', workspaceId).gt('fecha', lastDate),
    ])
    const cobrosPost = (cobrosDesde.data ?? []).reduce((s, c) => s + Number(c.monto), 0)
    const gastosPost = (gastosDesde.data ?? []).reduce((s, c) => s + Number(c.monto), 0)
    saldoTeorico = Number(ultimoSaldo.saldo_real) + cobrosPost - gastosPost
  } else {
    // First time: theoretical = all cobros - all gastos
    const [cobrosAll, gastosAll] = await Promise.all([
      supabase.from('cobros').select('monto').eq('workspace_id', workspaceId),
      supabase.from('gastos').select('monto').eq('workspace_id', workspaceId),
    ])
    const totalCobros = (cobrosAll.data ?? []).reduce((s, c) => s + Number(c.monto), 0)
    const totalGastos = (gastosAll.data ?? []).reduce((s, c) => s + Number(c.monto), 0)
    saldoTeorico = totalCobros - totalGastos
  }

  const diferencia = saldoReal - saldoTeorico

  const { error: insertError } = await supabase
    .from('saldos_banco')
    .insert({
      workspace_id: workspaceId,
      saldo_real: saldoReal,
      saldo_teorico: saldoTeorico,
      diferencia,
      registrado_via: 'app',
      nota: nota?.trim() || null,
    })

  if (insertError) return { success: false, error: insertError.message }

  // Update streak
  await upsertStreak(supabase, workspaceId)

  revalidatePath('/numeros')
  return {
    success: true,
    saldoTeorico,
    diferencia,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertStreak(supabase: any, workspaceId: string) {
  const { data: existing } = await supabase
    .from('streaks')
    .select('id, semanas_actuales, semanas_record, ultima_actualizacion')
    .eq('workspace_id', workspaceId)
    .eq('tipo', 'conciliacion')
    .maybeSingle()

  const now = new Date()

  if (!existing) {
    await supabase.from('streaks').insert({
      workspace_id: workspaceId,
      tipo: 'conciliacion',
      semanas_actuales: 1,
      semanas_record: 1,
      ultima_actualizacion: now.toISOString(),
      streak_inicio: now.toISOString().split('T')[0],
    })
    return
  }

  // Check if streak was broken (> 7 days)
  const lastUpdate = existing.ultima_actualizacion
    ? new Date(existing.ultima_actualizacion)
    : null
  const diasSinActualizar = lastUpdate
    ? Math.floor((now.getTime() - lastUpdate.getTime()) / 86400000)
    : 999

  let newSemanas = existing.semanas_actuales
  let streakInicio = undefined

  if (diasSinActualizar > 7) {
    // Streak broken — restart
    newSemanas = 1
    streakInicio = now.toISOString().split('T')[0]
  } else {
    // Check if this week was already counted
    const lastWeekNumber = lastUpdate ? getWeekNumber(lastUpdate) : -1
    const thisWeekNumber = getWeekNumber(now)
    if (thisWeekNumber !== lastWeekNumber) {
      newSemanas = existing.semanas_actuales + 1
    }
  }

  await supabase
    .from('streaks')
    .update({
      semanas_actuales: newSemanas,
      semanas_record: Math.max(existing.semanas_record, newSemanas),
      ultima_actualizacion: now.toISOString(),
      ...(streakInicio ? { streak_inicio: streakInicio } : {}),
      updated_at: now.toISOString(),
    })
    .eq('id', existing.id)
}

function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

// ── Save / Update Metas ───────────────────────────────

export async function saveMeta(mes: string, metaVentas: number, metaRecaudo?: number) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const mesDate = `${mes}-01`
  const recaudo = metaRecaudo ?? metaVentas * 0.8

  const { error: upsertError } = await supabase
    .from('config_metas')
    .upsert({
      workspace_id: workspaceId,
      mes: mesDate,
      meta_ventas_mensual: metaVentas,
      meta_recaudo_mensual: recaudo,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,mes' })

  if (upsertError) return { success: false, error: upsertError.message }

  revalidatePath('/numeros')
  revalidatePath('/config')
  return { success: true }
}

// ── Get Metas ─────────────────────────────────────────

export async function getMetas() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('config_metas')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('mes', { ascending: false })
    .limit(12)

  return data ?? []
}
