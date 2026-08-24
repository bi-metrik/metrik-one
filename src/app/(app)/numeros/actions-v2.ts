'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { FEATURES } from '@/lib/feature-flags'
import { bogotaParts, todayBogotaISO } from '@/lib/dates/bogota'
import { resumirCartera, type ItemCartera } from '@/lib/negocios/cartera'

// ── Types ─────────────────────────────────────────────

export interface NumerosData {
  // P1: Cuanta plata tengo
  saldoCaja: number
  saldoEsReal: boolean          // true = from saldos_banco, false = calculated
  recaudoMes: number             // recaudo PROPIO del mes, con IVA (v_pyl_mes.ingresos_con_iva)
  recaudoTercerosMes: number     // plata de terceros recaudada y por girar (tarifa UPME)
  metaRecaudo: number | null
  recaudoMesAnterior: number

  // P2: Estoy ganando
  ingresosMes: number            // ingreso RECONOCIDO del mes (v_pyl_mes: caja, o
                                 // completitud si el ws opta por P3 Ola 3)
  gastosMes: number              // gastos del mes
  gastosProyectosMes: number     // COH-5: gastos with proyecto_id (direct project costs)
  utilidad: number               // ingresos - gastos - costos fijos
  ingresosMesAnterior: number
  gastosMesAnterior: number

  // P3: Cuanto me deben
  carteraPendiente: number       // honorario aprobado - honorario recaudado (v_cartera_negocio)
  honorarioAprobado: number      // universo: negocios vivos con precio aprobado
  honorarioRecaudado: number     // de ese universo, lo ya imputado a honorario
  carteraNegocios: number        // cuantos negocios deben por encima de la tolerancia
  carteraMesAnterior: number | null  // null = no se puede reconstruir la foto del mes pasado
  carteraDetalle: CarteraItem[]  // negocio por negocio, del mas viejo al mas reciente

  // P4: Cuanto necesito vender
  ventasMes: number              // ventas del mes (v_venta_mes_comercial: mes del primer cobro)
  metaVentas: number | null
  costosFijosMes: number
  componenteNomina: number       // D129: auto from staff salaries
  componenteOperativo: number    // D129: from fixed_expenses
  staffNomina: { nombre: string; salario: number }[]  // D129: detail for drill-down
  // 2026-04-27: Refactor MC + EBITDA. Reemplaza blend D130.
  // mc/ebitda vienen de v_pyl_mes; margenContribucion = mc_pct (siempre calculado, no estimado)
  costosVariablesMes: number     // sum gastos.clasificacion_costo='variable' del mes
  margenContribucion: number     // mc_pct del mes (0-1) o fallback 0.95 si no hay data
  mcMonto: number                // ingresos - costos_variables del mes (numero absoluto)
  ebitda: number                 // mc - fijos_total (incluye nomina desde 2026-08-24)
  fijosTotalMes: number          // fijos_total de v_pyl_mes: el costo fijo que EBITDA si resta
  mcNegociosTop: McNegocio[]     // top-5 negocios por MC (drill-down P2)
  mcLineas: McLinea[]            // 2026-05-04: MC por linea del mes (drill-down P2)
  puntoEquilibrio: number

  // P5: Cuanto aguanto
  runwayMeses: number
  gastoPromedioMensual: number
  gastoTotalMensual: number        // gastoPromedioMensual + costosFijosMes

  // D119: Cuentas por pagar
  cxpTotal: number
  cxpCount: number

  // KPIs adicionales de negocio
  pipelineActivo: number       // SUM(valor_estimado) oportunidades no ganadas/perdidas
  valorContratado: number      // SUM(presupuesto_total) proyectos en_ejecucion

  // Semáforo
  semaforo: SemaforoData

  // Franja conciliación
  conciliacion: ConciliacionData | null

  // D129/D141: Deducibles
  totalDeduciblesMes: number     // sum of deducible fixed expenses monthly_amount
  regimenFiscal: 'ordinario' | 'simple' | null  // D141: workspace tax regime
  gastosDeduciblesMes: number    // D141: gastos variables with deducible category + soporte
  gastosSinSoporteMes: number    // D141: gastos variables with deducible category but no soporte

  // Meta info
  mesRef: string                 // YYYY-MM
  diaActual: number
  diasDelMes: number
  nombreUsuario: string

  // Modo Rentabilidad Comercial: workspace alimentado por ventas_hechos (export Siesa),
  // sin operacion viva en ONE. P2 muestra el margen real; P1/P3/P5 se activan al conectar la fuente.
  rentabilidadComercialMode: boolean
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

// Una sola definicion de la fila de cartera, la del modulo que la calcula.
export type CarteraItem = ItemCartera

export interface McNegocio {
  negocioId: string
  codigo: string | null
  nombre: string | null
  precio: number
  costosVariables: number
  mc: number
  mcPct: number | null
  estado: string | null
}

// 2026-05-04: MC por linea (decision Carmen + Mauricio).
// linea_id NULL = bucket "Sin linea" (gastos variables o cobros sin negocio asignado).
export interface McLinea {
  lineaId: string | null
  lineaNombre: string | null
  lineaTipo: string | null
  ingresos: number
  costosVariables: number
  mc: number
  mcPct: number | null
}

// ── getNumeros ────────────────────────────────────────

export async function getNumeros(mesRef?: string) {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  // Calendario Bogota — Vercel corre en UTC; ver src/lib/dates/bogota.ts.
  const hoyBogota = bogotaParts()
  const mesActualStr = `${hoyBogota.year}-${String(hoyBogota.month).padStart(2, '0')}`
  const mes = mesRef ?? mesActualStr
  const [yyyy, mm] = mes.split('-').map(Number)
  const mesStart = `${mes}-01`
  const mesEnd = new Date(yyyy, mm, 1).toISOString().split('T')[0]
  const diaActual = mes === mesActualStr ? hoyBogota.day : new Date(yyyy, mm, 0).getDate()
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
    ventasMesRes,
    carteraRes,
    configMetasRes,
    gastosFijosRes,
    streakRes,
    profileRes,
    // Semáforo indicators
    empresasRes,
    negociosVentaRes,
    horasRecientesRes,
    gastosFijosBorradoresRes,
    // D129: Nómina desde staff
    staffNominaRes,
    // 2026-04-27: v_pyl_mes para MC + EBITDA (reemplaza blend D130)
    pylMesRes,
    // 2026-07-08 P3 Ola 3: v_pyl_mes del mes ANTERIOR (ingreso reconocido prev)
    prevPylMesRes,
    // 2026-04-28: top-N negocios por MC (drill-down P2)
    mcNegociosRes,
    // 2026-05-04: MC por linea del mes (drill-down P2)
    mcLineasRes,
    // D141: Perfil fiscal (régimen)
    fiscalProfileRes,
    // D119: Cuentas por pagar
    cxpRes,
    // KPIs negocio
    negociosPipelineRes,
    negociosContratadosRes,
  ] = await Promise.all([
    // Latest bank balance (order by created_at — fecha can be NULL in old records)
    supabase
      .from('saldos_banco')
      .select('saldo_real, saldo_teorico, diferencia, fecha, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1),

    // Cobros del mes — recaudo/ingreso. Excluye tipo_cobro='pasante' (recaudo a
    // favor de terceros, ej. tarifa UPME: no es ingreso de SOENA). null-safe:
    // los cobros legacy sin tipo (NULL) siguen contando. Espeja v_pyl_mes.
    supabase
      .from('cobros')
      .select('monto')
      .eq('workspace_id', workspaceId)
      .gte('fecha', mesStart)
      .lt('fecha', mesEnd)
      .or('tipo_cobro.is.null,tipo_cobro.neq.pasante'),

    // Cobros mes anterior (misma exclusión de pasante)
    supabase
      .from('cobros')
      .select('monto')
      .eq('workspace_id', workspaceId)
      .gte('fecha', prevStart)
      .lt('fecha', prevEnd)
      .or('tipo_cobro.is.null,tipo_cobro.neq.pasante'),

    // Gastos del mes (include proyecto_id/negocio_id for COH-5, categoria/soporte for D141/D142)
    // 2026-04-27: estado_causacion eliminado, todos los gastos son reales
    supabase
      .from('gastos')
      .select('monto, proyecto_id, negocio_id, categoria, soporte_url, clasificacion_costo')
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

    // Ventas del mes. Antes leia `facturas`, que tiene 0 filas en los 15
    // workspaces: P4 daba $0 siempre. `v_venta_mes_comercial` ya define que es
    // una venta (el mes del primer cobro imputado) y es la misma definicion que
    // usa la pestaña Comercial de /tableros — una sola, no dos.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('v_venta_mes_comercial')
      .select('honorario_con_iva')
      .eq('workspace_id', workspaceId)
      .gte('fecha_venta', mesStart)
      .lt('fecha_venta', mesEnd),

    // Cartera negocio por negocio. Antes era `facturas - cobros`, que sin
    // facturas devolvia el recaudo historico EN NEGATIVO (-$88.973.023 en SOENA
    // contra $79.936.645 reales). Solo el honorario es cartera; la tarifa UPME
    // es plata de terceros. Ver la migracion 20260822000004.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('v_cartera_negocio')
      .select('negocio_id, codigo, nombre, honorario, honorario_recaudado, saldo, dias')
      .eq('workspace_id', workspaceId),

    // Metas del mes
    supabase
      .from('config_metas')
      .select('meta_ventas_mensual, meta_recaudo_mensual')
      .eq('workspace_id', workspaceId)
      .eq('mes', mesStart)
      .maybeSingle(),

    // Gastos fijos configurados (fixed_expenses = same table Mi Negocio uses)
    supabase
      .from('fixed_expenses')
      .select('monthly_amount, deducible')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true),

    // Streak
    supabase
      .from('streaks')
      .select('semanas_actuales, semanas_record, ultima_actualizacion')
      .eq('workspace_id', workspaceId)
      .eq('tipo', 'conciliacion')
      .maybeSingle(),

    // Profile name — current logged-in user
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', userId!)
      .single(),

    // Semáforo: empresas with fiscal data
    supabase
      .from('empresas')
      .select('id, numero_documento, regimen_tributario')
      .eq('workspace_id', workspaceId),

    // Semáforo: negocios activos en venta (recent activity)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('negocios')
      .select('id, updated_at')
      .eq('workspace_id', workspaceId)
      .eq('estado', 'abierto')
      .eq('stage_actual', 'venta'),

    // Semáforo: horas registradas recientes
    supabase
      .from('horas')
      .select('id')
      .eq('workspace_id', workspaceId)
      .gte('fecha', todayBogotaISO(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)))
      .limit(1),

    // Semáforo: gastos fijos borradores del mes
    supabase
      .from('gastos_fijos_borradores')
      .select('id, confirmado')
      .eq('workspace_id', workspaceId)
      .eq('periodo', mesStart),

    // D129: Empleados directos con salario (nómina — excluye contratistas/freelance)
    supabase
      .from('staff')
      .select('full_name, salary')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .eq('tipo_vinculo', 'empleado'),

    // 2026-04-27: PyL del mes desde vista (ingresos, variables, mc, fijos, ebitda)
    // 2026-08-22: + ingresos_con_iva y recaudo_terceros, para separar la plata
    // propia de la de terceros en P1. Las dos columnas existen en la vista pero
    // no en `types/database.ts`, que va por detras del esquema y no se puede
    // regenerar con las sesiones paralelas escribiendo; de ahi el cast.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('v_pyl_mes')
      .select('ingresos, ingresos_con_iva, recaudo_terceros, costos_variables, mc, mc_pct, fijos_total, ebitda')
      .eq('workspace_id', workspaceId)
      .eq('mes', mesStart)
      .maybeSingle(),

    // 2026-07-08 P3 Ola 3: PyL del mes ANTERIOR — solo ingresos (reconocido).
    // Espeja la base de la vista (caja o completitud según opt-in del ws).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('v_pyl_mes')
      .select('ingresos, ingresos_con_iva')
      .eq('workspace_id', workspaceId)
      .eq('mes', prevStart)
      .maybeSingle(),

    // 2026-04-28: top-N negocios por MC (abiertos primero, luego cerrados con MC > 0)
    supabase
      .from('v_mc_negocio')
      .select('negocio_id, negocio_codigo, negocio_nombre, precio_aprobado, precio_estimado, costos_variables, mc, mc_pct, estado')
      .eq('workspace_id', workspaceId)
      .order('mc', { ascending: false })
      .limit(20),

    // 2026-05-04: MC por linea del mes (linea_id NULL = bucket "Sin linea")
    supabase
      .from('v_mc_linea_mes')
      .select('linea_id, linea_nombre, linea_tipo, ingresos, costos_variables, mc, mc_pct')
      .eq('workspace_id', workspaceId)
      .eq('mes', mesStart)
      .order('mc', { ascending: false }),

    // D141: Perfil fiscal (régimen tributario del workspace)
    supabase
      .from('fiscal_profiles')
      .select('tax_regime')
      .eq('workspace_id', workspaceId)
      .maybeSingle(),

    // D119: Cuentas por pagar (all pending gastos, not month-scoped)
    supabase
      .from('gastos')
      .select('monto')
      .eq('workspace_id', workspaceId)
      .eq('estado_pago', 'pendiente'),

    // KPI: En venta — negocios en etapa venta
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('negocios')
      .select('precio_estimado')
      .eq('workspace_id', workspaceId)
      .eq('stage_actual', 'venta')
      .eq('estado', 'abierto'),

    // KPI: Valor contratado — negocios en ejecución/cobro
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('negocios')
      .select('precio_aprobado')
      .eq('workspace_id', workspaceId)
      .in('stage_actual', ['ejecucion', 'cobro'])
      .eq('estado', 'abierto'),
  ])

  // ── Calculate values ─────────────────────────────

  // Bank balance
  const ultimoSaldo = saldoBancoRes.data?.[0] ?? null
  const saldoEsReal = !!ultimoSaldo

  // Toda la plata que entró al banco en el mes, propia y ajena. Alimenta el
  // saldo estimado, que sí es caja: la tarifa por girar está en la cuenta hasta
  // que se gira.
  const cobrosTotalMes = (cobrosRes.data ?? []).reduce((s, c) => s + Number(c.monto), 0)
  const cobrosTotalMesAnterior = (cobrosPrevRes.data ?? []).reduce((s, c) => s + Number(c.monto), 0)

  // Recaudo PROPIO del mes, con IVA. La consulta de arriba filtraba
  // `tipo_cobro <> 'pasante'` para sacar la plata de terceros, pero en la base
  // NO EXISTE un solo cobro con ese tipo (medido 2026-08-22: solo `anticipo`,
  // `pago` y `externo`), así que el filtro nunca excluyó nada: en agosto SOENA
  // mostraba $45.305.692 recaudados cuando lo propio eran $20.033.000 y los
  // otros $25.272.692 son tarifa UPME por girar.
  //
  // Quien sí separa es la imputación (`v_cobro_valor`): honorario primero,
  // tarifa después. `v_pyl_mes` ya la agrega por mes, así que se lee de ahí en
  // vez de reimplementarla. El fallback a caja cubre el mes sin fila en la
  // vista, donde ambas cifras coinciden por definición.
  const recaudoMes = pylMesRes.data?.ingresos_con_iva != null
    ? Number(pylMesRes.data.ingresos_con_iva)
    : cobrosTotalMes
  const recaudoTercerosMes = pylMesRes.data?.recaudo_terceros != null
    ? Number(pylMesRes.data.recaudo_terceros)
    : 0
  const recaudoMesAnterior = prevPylMesRes.data?.ingresos_con_iva != null
    ? Number(prevPylMesRes.data.ingresos_con_iva)
    : cobrosTotalMesAnterior
  // Ingreso RECONOCIDO — se lee de v_pyl_mes (fuente única de ingreso→MC→EBITDA).
  // Para ws opt-in (P3 Ola 3) la vista aplica base COMPLETITUD; para el resto es
  // caja idéntica al recaudo → sin cambio. Fallback a caja si la vista no tiene
  // fila del mes (ej. mes sin movimientos en la vista pero con cobros sueltos).
  const ingresosMes = pylMesRes.data?.ingresos != null ? Number(pylMesRes.data.ingresos) : cobrosTotalMes
  const ingresosMesAnterior = prevPylMesRes.data?.ingresos != null ? Number(prevPylMesRes.data.ingresos) : cobrosTotalMesAnterior

  // Gastos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gastosData: any[] = gastosRes.data ?? []
  const gastosMes = gastosData.reduce((s: number, g: { monto: number }) => s + Number(g.monto), 0)
  const gastosProyectosMes = gastosData.filter((g: { proyecto_id?: string; negocio_id?: string }) => g.proyecto_id || g.negocio_id).reduce((s: number, g: { monto: number }) => s + Number(g.monto), 0)
  const gastosMesAnterior = (gastosPrevRes.data ?? []).reduce((s, g) => s + Number(g.monto), 0)

  // D141: Deducibles from variable gastos (categorías deducibles + soporte)
  const CATEGORIAS_DEDUCIBLES = ['materiales', 'transporte', 'servicios_profesionales', 'viaticos', 'software', 'impuestos_seguros', 'mano_de_obra']
  const gastosDeduciblesMes = gastosData
    .filter((g: { categoria: string; soporte_url: string | null }) => CATEGORIAS_DEDUCIBLES.includes(g.categoria) && g.soporte_url)
    .reduce((s: number, g: { monto: number }) => s + Number(g.monto), 0)
  const gastosSinSoporteMes = gastosData
    .filter((g: { categoria: string; soporte_url: string | null }) => CATEGORIAS_DEDUCIBLES.includes(g.categoria) && !g.soporte_url)
    .reduce((s: number, g: { monto: number }) => s + Number(g.monto), 0)

  // D141: Régimen fiscal
  const regimenFiscal = (fiscalProfileRes.data?.tax_regime as 'ordinario' | 'simple' | null) ?? null

  // D119: Cuentas por pagar
  const cxpData = cxpRes.data ?? []
  const cxpTotal = cxpData.reduce((s, g) => s + Number(g.monto), 0)
  const cxpCount = cxpData.length

  // KPIs negocio
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipelineActivo = (negociosPipelineRes.data ?? []).reduce((s: number, n: any) => s + Number(n.precio_estimado ?? 0), 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const valorContratado = (negociosContratadosRes.data ?? []).reduce((s: number, n: any) => s + Number(n.precio_aprobado ?? 0), 0)

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
  // Sobre los cobros TOTALES, no sobre el recaudo propio: la plata de terceros
  // sigue en la cuenta hasta que se gira, y esta linea estima caja.
  let saldoTeorico = cobrosTotalMes - gastosMes // simplified
  if (ultimoSaldo) {
    // Calculate theoretical from last real balance
    const lastBalanceDate = ultimoSaldo.fecha ?? ultimoSaldo.created_at ?? new Date().toISOString()
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
      .eq('estado_pago', 'pagado')  // D119: only paid gastos affect cash
      .gt('fecha', lastDateStr)

    const cobrosPostSaldo = (cobrosDesde.data ?? []).reduce((s, c) => s + Number(c.monto), 0)
    const gastosPostSaldo = (gastosDesde.data ?? []).reduce((s, c) => s + Number(c.monto), 0)
    saldoTeorico = Number(ultimoSaldo.saldo_real) + cobrosPostSaldo - gastosPostSaldo
  }

  const saldoCaja = ultimoSaldo ? Number(ultimoSaldo.saldo_real) : saldoTeorico

  // ── Cartera ──────────────────────────────────────
  //
  // El universo son los negocios vivos con precio aprobado: uno en Validacion
  // sin precio no debe nada todavia, y uno perdido tampoco. La cuenta vive en
  // `lib/negocios/cartera.ts`, con sus pruebas.
  const {
    carteraPendiente,
    honorarioAprobado,
    honorarioRecaudado,
    carteraNegocios,
    carteraVencida,
    detalle: carteraDetalle,
  } = resumirCartera(carteraRes.data ?? [])

  // La foto de la cartera del mes pasado no se puede reconstruir: haria falta
  // el historico de precios aprobados y de cobros a esa fecha, y no se guarda.
  // Antes se rellenaba con `carteraPendiente * 0.9`, un 10% inventado que
  // garantizaba que la flecha SIEMPRE dijera "bajando". Vale mas no dibujarla.
  const carteraMesAnterior = null

  // Ventas del mes: honorario con IVA de los negocios cuyo primer cobro cayo en
  // el mes. Antes sumaba `facturas`, tabla vacia en todos los workspaces.
  const ventasMes = (ventasMesRes.data ?? [])
    .reduce((s: number, v: { honorario_con_iva: number | string }) => s + Number(v.honorario_con_iva), 0)

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

  // D129: Gastos fijos compuestos (nómina + operativos)
  const gastosFijosData = gastosFijosRes.data ?? []
  const staffData = staffNominaRes.data ?? []
  const componenteNomina = staffData.reduce((s, st) => s + Number(st.salary ?? 0), 0)
  const componenteOperativo = gastosFijosData.reduce((s, g) => s + Number(g.monthly_amount), 0)
  const costosFijosMes = componenteNomina + componenteOperativo
  const staffNomina = staffData
    .filter(st => Number(st.salary ?? 0) > 0)
    .map(st => ({ nombre: st.full_name ?? 'Sin nombre', salario: Number(st.salary) }))

  // D129: Total deducibles (only from operativos — nómina not deducible this way)
  const totalDeduciblesMes = gastosFijosData
    .filter(g => g.deducible === true)
    .reduce((s, g) => s + Number(g.monthly_amount), 0)

  // 2026-04-27: MC + EBITDA desde v_pyl_mes (reemplaza blend D130)
  const pylMes = pylMesRes.data
  const costosVariablesMes = pylMes?.costos_variables ? Number(pylMes.costos_variables) : 0
  const mcPctRaw = pylMes?.mc_pct ? Number(pylMes.mc_pct) : null
  const margenContribucion = mcPctRaw !== null
    ? Math.max(0.05, Math.min(0.99, mcPctRaw))
    : 0.95  // fallback cuando no hay data del mes
  const mcMonto = pylMes?.mc ? Number(pylMes.mc) : (ingresosMes - costosVariablesMes)
  // 2026-08-24: `!= null` en vez de truthy. Un EBITDA de exactamente 0 es un dato, no un
  // hueco, y con la comparacion anterior caia al fallback y mostraba otro numero.
  const ebitda = pylMes?.ebitda != null
    ? Number(pylMes.ebitda)
    : (ingresosMes - costosVariablesMes - costosFijosMes)
  // El costo fijo que EBITDA resta de verdad. `costosFijosMes` (nomina + fixed_expenses) es
  // el compromiso recurrente y alimenta el punto de equilibrio; este ademas trae los gastos
  // del mes clasificados como fijos. Se expone para que el desglose de P2 cuadre con la resta
  // que la vista hizo, en vez de mostrar una linea que no da.
  const fijosTotalMes = pylMes?.fijos_total != null
    ? Number(pylMes.fijos_total)
    : costosFijosMes

  // 2026-04-28: top-5 negocios por MC. Filtra precio > 0 para excluir negocios sin precio definido
  const mcNegociosTop: McNegocio[] = (mcNegociosRes.data ?? [])
    .filter(n => n.negocio_id !== null)
    .map(n => ({
      negocioId: n.negocio_id as string,
      codigo: n.negocio_codigo,
      nombre: n.negocio_nombre,
      precio: Number(n.precio_aprobado ?? n.precio_estimado ?? 0),
      costosVariables: Number(n.costos_variables ?? 0),
      mc: Number(n.mc ?? 0),
      mcPct: n.mc_pct !== null ? Number(n.mc_pct) : null,
      estado: n.estado,
    }))
    .filter(n => n.precio > 0)
    .slice(0, 5)

  // 2026-05-04: MC por linea del mes. linea_id NULL = bucket "Sin linea"
  const mcLineas: McLinea[] = (mcLineasRes.data ?? []).map(l => ({
    lineaId: l.linea_id,
    lineaNombre: l.linea_nombre,
    lineaTipo: l.linea_tipo,
    ingresos: Number(l.ingresos ?? 0),
    costosVariables: Number(l.costos_variables ?? 0),
    mc: Number(l.mc ?? 0),
    mcPct: l.mc_pct !== null ? Number(l.mc_pct) : null,
  }))

  // PE
  const puntoEquilibrio = margenContribucion > 0 ? costosFijosMes / margenContribucion : costosFijosMes

  // Runway = saldo / (gastos variables promedio + gastos fijos mensuales)
  const gastoTotalMensual = gastoPromedioMensual + costosFijosMes
  const runwayMeses = gastoTotalMensual > 0 ? saldoCaja / gastoTotalMensual : 99

  // ── Conciliación ─────────────────────────────────
  const today = new Date()
  const streakData = streakRes.data
  const saldoFechaRef = ultimoSaldo?.fecha ?? ultimoSaldo?.created_at
  const diasDesdeUltimo = saldoFechaRef
    ? Math.floor((today.getTime() - new Date(saldoFechaRef).getTime()) / 86400000)
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
  if (diasDesdeUltimo === null || diasDesdeUltimo > 7) {
    conciliacionEstado = 4
  } else if (Math.abs(diferencia) > tolerancia) {
    conciliacionEstado = 3
  } else if (diasDesdeUltimo >= 4) {
    conciliacionEstado = 2
  }

  // ── Semáforo ─────────────────────────────────────
  const semaforo = calcularSemaforo({
    gastosFijosCount: (gastosFijosRes.data?.length ?? 0) + staffNomina.length,
    metaVentas,
    empresas: empresasRes.data ?? [],
    diasDesdeUltimoSaldo: diasDesdeUltimo,
    oportunidades: negociosVentaRes.data ?? [],
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

  const conciliacion: ConciliacionData | null = FEATURES.CONCILIACION ? {
    saldoReal: ultimoSaldo ? Number(ultimoSaldo.saldo_real) : null,
    saldoTeorico,
    diferencia,
    diasDesdeUltimo,
    streakSemanas,
    streakRecord,
    streakMilestone,
    estado: conciliacionEstado,
  } : null

  const nombre = profileRes.data?.full_name ?? 'Usuario'

  // ── Modo Rentabilidad Comercial (gateado) ────────────
  // Workspaces alimentados por ventas_hechos (export Siesa) no tienen cobros/gastos/saldo en ONE.
  // Encendemos P2 con su margen bruto real; el resto de paneles queda como "el norte" (se activa al conectar).
  let rentabilidadComercialMode = false
  let p2Ingresos = ingresosMes
  let p2Costo = gastosMes
  let p2Utilidad = ingresosMes - gastosMes - costosFijosMes
  let p2Margen = margenContribucion
  let p2McMonto = mcMonto
  let p2Ebitda = ebitda
  {
    const { data: wsMod } = await supabase.from('workspaces').select('modules').eq('id', workspaceId).single()
    const mods = (wsMod?.modules ?? {}) as Record<string, boolean>
    if (mods.rentabilidad_comercial) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: rc } = await (supabase as any).rpc('get_rentabilidad_comercial', { p_anio: null })
      const k = rc?.kpis
      if (k && Number(k.ventaNeta) > 0) {
        rentabilidadComercialMode = true
        p2Ingresos = Number(k.ventaNeta)
        p2Costo = Number(k.costo)
        p2Utilidad = Number(k.utilidad)
        p2McMonto = Number(k.utilidad)
        p2Ebitda = Number(k.utilidad) // proxy: sin gasto operativo no hay EBITDA real (ver footer del tab)
        p2Margen = Number(k.margenPct) / 100
      }
    }
  }

  return {
    saldoCaja,
    saldoEsReal,
    recaudoMes,
    recaudoTercerosMes,
    metaRecaudo,
    recaudoMesAnterior,
    ingresosMes: p2Ingresos,
    gastosMes: p2Costo,
    gastosProyectosMes,
    utilidad: p2Utilidad,
    ingresosMesAnterior,
    gastosMesAnterior,
    carteraPendiente,
    honorarioAprobado,
    honorarioRecaudado,
    carteraNegocios,
    carteraMesAnterior,
    carteraDetalle,
    ventasMes,
    metaVentas,
    costosFijosMes,
    fijosTotalMes,
    componenteNomina,
    componenteOperativo,
    staffNomina,
    costosVariablesMes,
    margenContribucion: p2Margen,
    mcMonto: p2McMonto,
    ebitda: p2Ebitda,
    mcNegociosTop,
    mcLineas,
    puntoEquilibrio,
    runwayMeses,
    gastoPromedioMensual,
    gastoTotalMensual,
    totalDeduciblesMes,
    regimenFiscal,
    gastosDeduciblesMes,
    gastosSinSoporteMes,
    cxpTotal,
    cxpCount,
    pipelineActivo,
    valorContratado,
    semaforo,
    conciliacion,
    mesRef: mes,
    diaActual,
    diasDelMes,
    nombreUsuario: nombre.split(' ')[0],
    rentabilidadComercialMode,
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

  // 1. Gastos fijos configurados (Crítico, peso 3) — 1+ es suficiente para verde
  const gfScore = input.gastosFijosCount >= 1 ? 'green' : 'red'
  totalWeight += 3
  if (gfScore === 'green') greenWeight += 3
  pendientes.push({
    label: 'Gastos fijos configurados',
    done: gfScore === 'green',
    action: gfScore !== 'green' ? '/mi-negocio' : undefined,
  })

  // 2. Meta ventas definida (Crítico, peso 3)
  const metaScore = input.metaVentas && input.metaVentas > 0 ? 'green' : 'red'
  totalWeight += 3
  if (metaScore === 'green') greenWeight += 3
  pendientes.push({
    label: 'Meta de ventas definida',
    done: metaScore === 'green',
    action: metaScore !== 'green' ? '/mi-negocio' : undefined,
  })

  // 3. Datos fiscales clientes activos (Informativo — no bloquea números)
  const empresasTotal = input.empresas.length
  const empresasCompletas = input.empresas.filter(e => e.numero_documento && e.regimen_tributario).length
  const fiscalDone = empresasTotal === 0 || empresasCompletas === empresasTotal
  // No suma al peso — es solo informativo
  if (!fiscalDone && empresasTotal > 0) {
    pendientes.push({
      label: `Datos fiscales de ${empresasTotal - empresasCompletas} empresa${empresasTotal - empresasCompletas > 1 ? 's' : ''} (recomendado)`,
      done: false,
      action: '/directorio',
    })
  }

  // 4. Saldo bancario actualizado (Alto, peso 2) — 7d verde, 14d amarillo, 30d+ rojo
  const saldoScore = input.diasDesdeUltimoSaldo === null
    ? 'red'
    : input.diasDesdeUltimoSaldo <= 7 ? 'green' : input.diasDesdeUltimoSaldo <= 14 ? 'yellow' : 'red'
  totalWeight += 2
  if (saldoScore === 'green') greenWeight += 2
  else if (saldoScore === 'yellow') greenWeight += 1
  pendientes.push({
    label: 'Saldo bancario actualizado',
    done: saldoScore === 'green',
    action: saldoScore !== 'green' ? '/numeros?saldo=1' : undefined,
  })

  // 5. Negocios actualizados (Medio, peso 1)
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
      label: 'Negocios actualizados',
      done: false,
      action: '/negocios',
    })
  } else {
    pendientes.push({ label: 'Negocios actualizados', done: oppsActivas.length === 0 || oppsScore === 'green' })
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

  // 7. Horas al día (Bajo, peso 1)
  totalWeight += 1
  if (input.horasRecientes) greenWeight += 1
  pendientes.push({
    label: 'Horas al día',
    done: input.horasRecientes,
    action: !input.horasRecientes ? '/negocios' : undefined,
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
    label: 'Conciliación bancaria al día',
    done: diffScore === 'green' || saldoScore === 'green',
  })

  const capa1Score = Math.round((greenWeight / totalWeight) * 100)
  const capa1Estado: 'red' | 'yellow' | 'green' =
    capa1Score >= 50 ? 'green' : capa1Score >= 30 ? 'yellow' : 'red'

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
      if (runwayColor === 'red') capa2Razon = `Aguantas ${input.runwayMeses.toFixed(1)} meses — acelera cobros o reduce gastos`
      else if (factColor === 'red') capa2Razon = `Ventas por debajo del minimo necesario — faltan $${Math.round(input.puntoEquilibrio - input.ventasMes).toLocaleString('es-CO')}`
      else capa2Razon = `Cartera vencida: ${Math.round(pctCarteraVencida * 100)}% — revisa cobros pendientes`
    } else if (colors.includes('yellow')) {
      capa2Estado = 'yellow'
      if (runwayColor === 'yellow') capa2Razon = `Aguantas ${input.runwayMeses.toFixed(1)} meses`
      else if (factColor === 'yellow') capa2Razon = `Ventas entre el minimo y la meta — vas bien, sigue cerrando`
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
    const faltantes = pendientes.filter(p => !p.done).map(p => p.label).slice(0, 2)
    mensaje = `Falta: ${faltantes.join(', ')}`
  } else if (capa1Estado === 'yellow') {
    const pendientesCount = pendientes.filter(p => !p.done).length
    mensaje = `${pendientesCount} dato${pendientesCount > 1 ? 's' : ''} por actualizar — tus numeros ya son visibles`
  } else if (capa2Estado === 'green') {
    mensaje = 'Todo al dia'
  } else if (capa2Estado === 'yellow') {
    mensaje = capa2Razon ?? 'Hay temas que atender'
  } else if (capa2Estado === 'red') {
    mensaje = capa2Razon ?? 'Atencion requerida'
  } else {
    mensaje = 'Datos completos'
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

  // Calculate theoretical balance (order by created_at — fecha can be NULL in old records)
  const { data: ultimoSaldo } = await supabase
    .from('saldos_banco')
    .select('saldo_real, fecha, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let saldoTeorico = 0
  if (ultimoSaldo) {
    const lastDate = (ultimoSaldo.fecha ?? ultimoSaldo.created_at ?? new Date().toISOString()).split('T')[0]
    const [cobrosDesde, gastosDesde] = await Promise.all([
      supabase.from('cobros').select('monto').eq('workspace_id', workspaceId).gt('fecha', lastDate),
      supabase.from('gastos').select('monto').eq('workspace_id', workspaceId).eq('estado_pago', 'pagado').gt('fecha', lastDate),
    ])
    const cobrosPost = (cobrosDesde.data ?? []).reduce((s, c) => s + Number(c.monto), 0)
    const gastosPost = (gastosDesde.data ?? []).reduce((s, c) => s + Number(c.monto), 0)
    saldoTeorico = Number(ultimoSaldo.saldo_real) + cobrosPost - gastosPost
  } else {
    // First time: theoretical = all cobros - all gastos
    const [cobrosAll, gastosAll] = await Promise.all([
      supabase.from('cobros').select('monto').eq('workspace_id', workspaceId),
      supabase.from('gastos').select('monto').eq('workspace_id', workspaceId).eq('estado_pago', 'pagado'),
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
      fecha: new Date().toISOString(),
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
      streak_inicio: todayBogotaISO(now),
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
    streakInicio = todayBogotaISO(now)
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
