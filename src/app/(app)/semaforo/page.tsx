import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SemaforoClient from './semaforo-client'

// Collection probability by aging
const PROBABILIDAD_COBRO: Record<string, number> = {
  por_vencer: 0.95,
  vencida_1_30: 0.75,
  vencida_31_60: 0.50,
  vencida_61_90: 0.25,
  vencida_mas_90: 0.10,
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function fmtFecha(fecha: Date): string {
  return `${fecha.getDate()} de ${MESES[fecha.getMonth()]}`
}

function fmtMoneda(monto: number): string {
  if (monto >= 1000000) return `$${(monto / 1000000).toFixed(1)}M`
  return `$${monto.toLocaleString('es-CO')}`
}

export default async function SemaforoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/onboarding')
  if (!['owner', 'admin'].includes(profile.role)) redirect('/dashboard')

  const now = new Date()

  // Parallel data fetches
  const [
    bankAccountsRes,
    bankBalancesRes,
    invoicesRes,
    paymentsRes,
    expensesRes,
    fixedExpensesRes,
  ] = await Promise.all([
    supabase.from('bank_accounts').select('id, bank_name, is_primary').eq('workspace_id', profile.workspace_id).eq('is_active', true),
    supabase.from('bank_balances').select('*').eq('workspace_id', profile.workspace_id).order('recorded_at', { ascending: false }),
    supabase.from('invoices').select('*').eq('workspace_id', profile.workspace_id),
    supabase.from('payments').select('*').eq('workspace_id', profile.workspace_id),
    supabase.from('expenses').select('*').eq('workspace_id', profile.workspace_id),
    supabase.from('fixed_expenses').select('*').eq('workspace_id', profile.workspace_id).eq('is_active', true),
  ])

  const bankAccounts = bankAccountsRes.data || []
  const bankBalances = bankBalancesRes.data || []
  const invoices = invoicesRes.data || []
  const allPayments = paymentsRes.data || []
  const expenses = expensesRes.data || []
  const fixedExpenses = fixedExpensesRes.data || []

  // ══ P1: SALDO REAL ══
  // Last balance per account
  const saldosPorCuenta: Record<string, { saldo: number; fecha: Date }> = {}
  for (const bal of bankBalances) {
    if (!saldosPorCuenta[bal.account_id]) {
      saldosPorCuenta[bal.account_id] = { saldo: bal.balance, fecha: new Date(bal.recorded_at) }
    }
  }
  const saldoReal = Object.values(saldosPorCuenta).reduce((s, b) => s + b.saldo, 0)

  // Days since last balance update
  const fechasUpdate = Object.values(saldosPorCuenta).map(s => s.fecha)
  const ultimaActualizacion = fechasUpdate.length > 0 ? new Date(Math.max(...fechasUpdate.map(f => f.getTime()))) : null
  const diasSinActualizar = ultimaActualizacion
    ? Math.floor((now.getTime() - ultimaActualizacion.getTime()) / (1000 * 60 * 60 * 24))
    : 999

  // ══ P2: CARTERA POR COBRAR ══
  const facturasPendientes = invoices.filter(i => i.status === 'scheduled' || i.status === 'partial')

  let carteraTotal = 0
  let carteraAjustada = 0
  const clientesRiesgo: Array<{ concepto: string; monto: number; diasVencida: number }> = []

  for (const inv of facturasPendientes) {
    carteraTotal += inv.gross_amount
    const fechaVenc = inv.due_date ? new Date(inv.due_date) : null
    const diasVencida = fechaVenc ? Math.floor((now.getTime() - fechaVenc.getTime()) / (1000 * 60 * 60 * 24)) : 0

    let probabilidad = PROBABILIDAD_COBRO.por_vencer
    if (diasVencida > 90) probabilidad = PROBABILIDAD_COBRO.vencida_mas_90
    else if (diasVencida > 60) probabilidad = PROBABILIDAD_COBRO.vencida_61_90
    else if (diasVencida > 30) probabilidad = PROBABILIDAD_COBRO.vencida_31_60
    else if (diasVencida > 0) probabilidad = PROBABILIDAD_COBRO.vencida_1_30

    carteraAjustada += inv.gross_amount * probabilidad

    if (diasVencida > 30) {
      clientesRiesgo.push({ concepto: inv.concept, monto: inv.gross_amount, diasVencida })
    }
  }
  clientesRiesgo.sort((a, b) => b.diasVencida - a.diasVencida)

  // ══ P3: CUENTAS POR PAGAR ══
  const totalGastosFijos = fixedExpenses.reduce((s, f) => s + f.monthly_amount, 0)

  // Average monthly expenses (last 90 days)
  const hace90Dias = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const gastosUltimos90 = expenses.filter(e => new Date(e.expense_date) >= hace90Dias)
  const gastoMensualPromedio = gastosUltimos90.length > 0
    ? gastosUltimos90.reduce((s, g) => s + g.amount, 0) / 3
    : totalGastosFijos

  const totalPorPagar = totalGastosFijos

  // ══ P4: FECHA CRÍTICA (Cash flow projection) ══
  interface Movimiento { fecha: Date; tipo: 'ingreso' | 'egreso'; monto: number; concepto: string }
  const movimientos: Movimiento[] = []

  // Future income: pending invoices with due dates
  for (const inv of facturasPendientes) {
    if (inv.due_date) {
      const fechaPago = new Date(inv.due_date)
      if (fechaPago >= now) {
        const diasVencida = Math.floor((now.getTime() - fechaPago.getTime()) / (1000 * 60 * 60 * 24))
        let probabilidad = PROBABILIDAD_COBRO.por_vencer
        if (diasVencida > 90) probabilidad = PROBABILIDAD_COBRO.vencida_mas_90
        else if (diasVencida > 60) probabilidad = PROBABILIDAD_COBRO.vencida_61_90
        else if (diasVencida > 30) probabilidad = PROBABILIDAD_COBRO.vencida_31_60
        else if (diasVencida > 0) probabilidad = PROBABILIDAD_COBRO.vencida_1_30
        movimientos.push({ fecha: fechaPago, tipo: 'ingreso', monto: inv.gross_amount * probabilidad, concepto: inv.concept })
      }
    }
  }

  // Future expenses: fixed expenses next 3 months
  for (let mes = 0; mes < 3; mes++) {
    for (const fe of fixedExpenses) {
      const fechaPago = new Date(now.getFullYear(), now.getMonth() + mes, 15) // Assume mid-month
      if (fechaPago >= now) {
        movimientos.push({ fecha: fechaPago, tipo: 'egreso', monto: fe.monthly_amount, concepto: fe.description })
      }
    }
  }

  movimientos.sort((a, b) => a.fecha.getTime() - b.fecha.getTime())

  let saldoSimulado = saldoReal
  let fechaCritica: Date | null = null

  for (const mov of movimientos) {
    saldoSimulado += mov.tipo === 'ingreso' ? mov.monto : -mov.monto
    if (saldoSimulado < 0 && !fechaCritica) {
      fechaCritica = mov.fecha
    }
  }

  const diasHastaFechaCritica = fechaCritica
    ? Math.floor((fechaCritica.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null

  // ══ CONSOLIDATED TRAFFIC LIGHT ══
  type Estado = 'verde' | 'amarillo' | 'rojo'

  // P2 state
  const ratioP2 = gastoMensualPromedio > 0 ? carteraAjustada / gastoMensualPromedio : 0
  let estadoP2: Estado = 'rojo'
  if (ratioP2 > 1.5) estadoP2 = 'verde'
  else if (ratioP2 >= 0.8) estadoP2 = 'amarillo'

  // P3 state
  const ingresoMensualEstimado = carteraAjustada / 3
  const ratioP3 = ingresoMensualEstimado > 0 ? totalPorPagar / ingresoMensualEstimado : 999
  let estadoP3: Estado = 'rojo'
  if (ratioP3 < 0.7) estadoP3 = 'verde'
  else if (ratioP3 <= 1.2) estadoP3 = 'amarillo'

  // P4 state
  let estadoP4: Estado = 'verde'
  if (diasHastaFechaCritica !== null) {
    if (diasHastaFechaCritica < 30) estadoP4 = 'rojo'
    else if (diasHastaFechaCritica < 60) estadoP4 = 'amarillo'
  }

  // Consolidate
  const estados = [estadoP2, estadoP3, estadoP4]
  let estadoConsolidado: Estado = 'verde'
  if (estados.includes('rojo')) estadoConsolidado = 'rojo'
  else if (estados.includes('amarillo')) estadoConsolidado = 'amarillo'

  // Confidence
  let nivelConfianza: 'alta' | 'media' | 'baja' = 'alta'
  if (diasSinActualizar > 7) nivelConfianza = 'baja'
  else if (diasSinActualizar > 2) nivelConfianza = 'media'

  if (nivelConfianza === 'baja' && estadoConsolidado === 'verde') estadoConsolidado = 'amarillo'

  // ══ MESSAGES ══
  let emoji = '🟢'
  let mensajePrincipal = 'Tu negocio está bien'
  let mensajeSecundario = ''

  if (fechaCritica) {
    if (diasHastaFechaCritica !== null && diasHastaFechaCritica < 30) {
      emoji = '🔴'; mensajePrincipal = 'Alerta: tu negocio necesita acción urgente'
      mensajeSecundario = `El ${fmtFecha(fechaCritica)} te quedas sin plata`
    } else if (diasHastaFechaCritica !== null && diasHastaFechaCritica < 60) {
      emoji = '🟡'; mensajePrincipal = 'Tu negocio necesita atención'
      mensajeSecundario = `Ojo: tienes plata hasta el ${fmtFecha(fechaCritica)}`
    } else {
      mensajeSecundario = `Tienes plata hasta el ${fmtFecha(fechaCritica)}`
    }
  } else {
    if (totalPorPagar > 0 && saldoReal > 0) {
      const diasSupervivencia = Math.floor((saldoReal / totalPorPagar) * 30)
      const fechaEstimada = new Date(now)
      fechaEstimada.setDate(fechaEstimada.getDate() + diasSupervivencia)
      if (diasSupervivencia >= 90) {
        mensajeSecundario = `Tienes plata hasta el ${fmtFecha(fechaEstimada)}`
      } else if (diasSupervivencia >= 30) {
        emoji = '🟡'; mensajePrincipal = 'Tu negocio necesita atención'
        mensajeSecundario = `Tienes plata hasta el ${fmtFecha(fechaEstimada)}`
      } else {
        emoji = '🔴'; mensajePrincipal = 'Alerta: tu negocio necesita acción urgente'
        mensajeSecundario = `Te quedas sin plata el ${fmtFecha(fechaEstimada)}`
      }
    } else if (saldoReal <= 0) {
      emoji = '🔴'; mensajePrincipal = 'Alerta: tu saldo está en cero'
      mensajeSecundario = 'Registra ingresos o actualiza tus saldos'
    } else {
      mensajeSecundario = 'Registra tus gastos fijos para mayor precisión'
    }
  }

  if (emoji === '🟢' && clientesRiesgo.length >= 3) {
    emoji = '🟡'; mensajePrincipal = 'Tu negocio necesita atención'
  }

  if (nivelConfianza === 'baja') {
    emoji = '😴'; mensajePrincipal = 'Actualiza tus saldos'
    mensajeSecundario = `Llevas ${diasSinActualizar} días sin actualizar`
  }

  // ══ SUGGESTED ACTION ══
  let accionTipo = ''
  let accionTitulo = ''
  let accionSubtitulo = ''

  if (diasSinActualizar > 3) {
    accionTipo = 'actualizar'; accionTitulo = 'Actualiza tus saldos'
    accionSubtitulo = `Llevas ${diasSinActualizar} días sin actualizar`
  } else if (clientesRiesgo.some(c => c.diasVencida > 60)) {
    const c = clientesRiesgo.find(c => c.diasVencida > 60)!
    accionTipo = 'cobrar'; accionTitulo = `Cobra: ${c.concepto}`
    accionSubtitulo = `${fmtMoneda(c.monto)} hace ${c.diasVencida} días`
  } else if (clientesRiesgo.length > 0) {
    const c = clientesRiesgo[0]
    accionTipo = 'cobrar'; accionTitulo = `Cobra: ${c.concepto}`
    accionSubtitulo = `${fmtMoneda(c.monto)} hace ${c.diasVencida} días`
  } else if (fechaCritica && diasHastaFechaCritica !== null && diasHastaFechaCritica < 60) {
    accionTipo = 'flujo'; accionTitulo = 'Revisa tu flujo de caja'
    accionSubtitulo = `El ${fmtFecha(fechaCritica)} podrías quedarte corto`
  }

  return (
    <SemaforoClient
      data={{
        semaforo: { estado: estadoConsolidado, emoji, mensajePrincipal, mensajeSecundario },
        resumen: {
          tienes: saldoReal,
          teDeben: carteraTotal,
          teDebenSeguro: carteraAjustada,
          debes: totalPorPagar,
          gastoMensual: gastoMensualPromedio,
        },
        indicadores: {
          p2: { estado: estadoP2, ratio: ratioP2 },
          p3: { estado: estadoP3, ratio: ratioP3 },
          p4: { estado: estadoP4, diasHastaFechaCritica },
        },
        confianza: { nivel: nivelConfianza, diasSinActualizar },
        accion: accionTipo ? { tipo: accionTipo, titulo: accionTitulo, subtitulo: accionSubtitulo } : null,
        clientesRiesgo,
        tieneCuentas: bankAccounts.length > 0,
      }}
    />
  )
}
