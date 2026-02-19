'use server'

import { createClient } from '@/lib/supabase/server'

export async function getDashboardData(workspaceId: string) {
  const supabase = await createClient()
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
  const monthEnd = new Date(year, month, 0).toISOString().split('T')[0]

  const [
    monthlyTargetRes,
    invoicesRes,
    paymentsRes,
    expensesRes,
    fixedExpensesRes,
    bankBalancesRes,
    projectsRes,
    opportunitiesRes,
    timeEntriesRes,
  ] = await Promise.all([
    // Monthly target for this month
    supabase
      .from('monthly_targets')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('year', year)
      .eq('month', month)
      .maybeSingle(),
    // All invoices
    supabase
      .from('invoices')
      .select('*')
      .eq('workspace_id', workspaceId),
    // All payments
    supabase
      .from('payments')
      .select('*')
      .eq('workspace_id', workspaceId),
    // Expenses this month
    supabase
      .from('expenses')
      .select('*')
      .eq('workspace_id', workspaceId)
      .gte('expense_date', monthStart)
      .lte('expense_date', monthEnd),
    // Fixed expenses
    supabase
      .from('fixed_expenses')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true),
    // Latest bank balance per account
    supabase
      .from('bank_balances')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('recorded_at', { ascending: false }),
    // Active projects
    supabase
      .from('projects')
      .select('id, name, approved_budget, status')
      .eq('workspace_id', workspaceId)
      .in('status', ['active', 'rework']),
    // Won opportunities this month
    supabase
      .from('opportunities')
      .select('id, estimated_value, stage')
      .eq('workspace_id', workspaceId)
      .eq('stage', 'won')
      .gte('updated_at', monthStart),
    // Time entries this month
    supabase
      .from('time_entries')
      .select('hours')
      .eq('workspace_id', workspaceId)
      .gte('entry_date', monthStart)
      .lte('entry_date', monthEnd),
  ])

  const target = monthlyTargetRes.data
  const invoices = invoicesRes.data || []
  const payments = paymentsRes.data || []
  const expensesMonth = expensesRes.data || []
  const fixedExpenses = fixedExpensesRes.data || []
  const bankBalances = bankBalancesRes.data || []
  const projects = projectsRes.data || []
  const wonOpps = opportunitiesRes.data || []
  const timeEntries = timeEntriesRes.data || []

  // Latest bank balance per account
  const saldosPorCuenta: Record<string, number> = {}
  for (const bal of bankBalances) {
    if (!saldosPorCuenta[bal.account_id]) {
      saldosPorCuenta[bal.account_id] = bal.balance
    }
  }
  const cajaActual = Object.values(saldosPorCuenta).reduce((s, v) => s + v, 0)

  // Monthly payments received
  const paymentsThisMonth = payments.filter(p =>
    p.payment_date >= monthStart && p.payment_date <= monthEnd
  )
  const cobradoMes = paymentsThisMonth.reduce((s, p) => s + p.net_received, 0)

  // Monthly sales = won opps value + invoiced this month
  const ventasMes = wonOpps.reduce((s, o) => s + o.estimated_value, 0)

  // Monthly expenses
  const gastosMes = expensesMonth.reduce((s, e) => s + e.amount, 0)
  const gastosFijosMes = fixedExpenses.reduce((s, f) => s + f.monthly_amount, 0)
  const gastoTotalMes = gastosMes + gastosFijosMes

  // All-time totals
  const totalInvoiced = invoices.reduce((s, i) => s + i.gross_amount, 0)
  const totalCollected = payments.reduce((s, p) => s + p.net_received, 0)
  const totalRetentions = payments.reduce((s, p) => s + (p.retention_applied || 0), 0)

  // Monthly hours
  const horasMes = timeEntries.reduce((s, t) => s + t.hours, 0)

  // Pending invoices
  const pendingInvoices = invoices.filter(i => i.status === 'scheduled' || i.status === 'partial')
  const pendingAmount = pendingInvoices.reduce((s, i) => s + i.gross_amount, 0)

  // Punto de equilibrio = gastos fijos mensuales
  const puntoEquilibrio = gastosFijosMes

  // Utilidad del mes = cobrado - gastos - fiscal estimado
  const fiscalEstimado = cobradoMes * 0.11 + cobradoMes * 0.4 * 0.285 // retefuente + seg social
  const utilidadMes = cobradoMes - gastoTotalMes - fiscalEstimado

  // Margin %
  const margenMes = cobradoMes > 0 ? (utilidadMes / cobradoMes) * 100 : 0

  // Runway (months of expenses covered by cash)
  const runway = gastoTotalMes > 0 ? cajaActual / gastoTotalMes : 999

  return {
    // Pulso del Mes (F16)
    pulso: {
      ventasMes,
      metaVentas: target?.sales_target || 0,
      cobradoMes,
      metaCobros: target?.collection_target || 0,
      gastoTotalMes,
      gastosFijosMes,
    },
    // Cinco Preguntas (F17)
    preguntas: {
      caja: cajaActual,
      utilidad: utilidadMes,
      margen: margenMes,
      puntoEquilibrio,
      runway: Math.min(runway, 12),
    },
    // Quick stats
    stats: {
      projectsActive: projects.length,
      horasMes,
      pendingAmount,
      pendingCount: pendingInvoices.length,
      totalCollected,
      totalRetentions,
    },
    hasMetas: !!target,
    hasBankData: Object.keys(saldosPorCuenta).length > 0,
  }
}
